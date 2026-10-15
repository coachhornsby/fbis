import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {compactArchivedRaw,restoreArchivedRaw,payloadHash,receiptKey,compactPolymarketPayloadBatch} from '../functions/lib/polymarketPayloadArchive.js';
import {polymarketUsMarketFamily,polymarketUsPeriod,polymarketUsSideLabel} from '../functions/lib/polymarketUs.js';
import {onRequestPost} from '../functions/api/polymarket-storage.js';
const rawKey='market-sources/polymarket-us/raw/'+'a'.repeat(64)+'.json';
const raw={receiptId:'fixture-123',rawSnapshotKey:rawKey,providerMarketId:'market1',providerOutcomeId:'yes1',providerTitle:'Home vs Away',contractLong:true,sourceObservedAt:null,quoteProvenance:'collector-capture-only',providerMarket:{id:'market1',sportsMarketType:'soccer_team_full_time_winner',sportsMarketTypeV2:'SPORTS_MARKET_TYPE_MONEYLINE',title:'Home (Reg. Time)',description:'Full settlement rules remain available',marketSides:[{id:'yes1',quote:.6,long:true,team:{name:'Home'},branding:'x'.repeat(2000)},{id:'no1',quote:.4,long:false,team:{name:'Away'},branding:'y'.repeat(2000)}]},providerSide:{id:'yes1',long:true,team:{name:'Home'},quote:.6}};
const receipt={receiptId:raw.receiptId,rawKey,offers:[{raw}]};
const archive=(r=receipt)=>({async get(k){assert.equal(k,receiptKey(raw.receiptId));return r?{size:JSON.stringify(r).length,async json(){return structuredClone(r)}}:null;}});
test('round-trip restores exact original hash while preserving every live identity and settlement field',async()=>{
 const original=await payloadHash(raw),c=await compactArchivedRaw(raw,receipt,{originalHash:original});assert.equal(c.changed,true);
 assert.equal(c.raw.providerMarket.marketSides,undefined);assert.equal(c.raw.providerMarket.description,raw.providerMarket.description);
 for(const f of [polymarketUsMarketFamily,polymarketUsPeriod])assert.equal(f(c.raw.providerMarket),f(raw.providerMarket));
 assert.equal(polymarketUsSideLabel(c.raw.providerMarket,c.raw.providerSide,'soccer'),'Home');
 const restored=await restoreArchivedRaw(c.raw,archive(),{storedHash:await payloadHash(c.raw)});assert.deepEqual(restored,raw);assert.equal(await payloadHash(restored),original);
 assert.equal((await compactArchivedRaw(c.raw,receipt)).changed,false);
});
test('missing, wrong-time or corrupted source evidence never permits compaction or reconstruction',async()=>{
 assert.equal((await compactArchivedRaw(raw,{...receipt,rawKey:'wrong'})).changed,false);
 assert.equal((await compactArchivedRaw(raw,{...receipt,offers:[{raw:{...raw,contractLong:false}}]})).changed,false);
 assert.equal((await compactArchivedRaw(raw,receipt,{originalHash:'bad'})).changed,false);
 const c=(await compactArchivedRaw(raw,receipt)).raw;
 await assert.rejects(restoreArchivedRaw(c,archive(null)),/MISSING/);
 await assert.rejects(restoreArchivedRaw(c,archive({...receipt,offers:[]})),/HASH_MISMATCH/);
 await assert.rejects(restoreArchivedRaw(c,archive(),{storedHash:'bad'}),/STORED_PAYLOAD_HASH/);
 await assert.rejects(restoreArchivedRaw({...c,archiveRef:{...c.archiveRef,receiptKey:'private/account'}},archive()),/INVALID_ARCHIVE/);
});
function fixtureDb(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE normalized_market_observations(id TEXT PRIMARY KEY,source TEXT,collected_at TEXT,contract_price REAL,canonical_event_id TEXT,raw_payload_json TEXT,raw_payload_hash TEXT)');
 return {sqlite,prepare(sql){return {bind(...args){return {async all(){return {results:sqlite.prepare(sql).all(...args)}},async first(){return sqlite.prepare(sql).get(...args)},sql,args}}}},async batch(stmts){sqlite.exec('BEGIN');try{const result=stmts.map(s=>({meta:{changes:sqlite.prepare(s.sql).run(...s.args).changes}}));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
test('real SQLite migration is repeatable, dry-run safe and changes only the storage representation',async()=>{
 const DB=fixtureDb(),s=JSON.stringify(raw),h=await payloadHash(s);
 DB.sqlite.prepare('INSERT INTO normalized_market_observations VALUES(?,?,?,?,?,?,?)').run('nmo_'+'1'.repeat(28),'Polymarket US','2026-10-14T12:00:00Z',.6,'event1',s,h);
 DB.sqlite.prepare('INSERT INTO normalized_market_observations VALUES(?,?,?,?,?,?,?)').run('nmo_'+'2'.repeat(28),'PinnOdds','2026-10-14T12:00:00Z',.7,'event2',s,h);
 const env={DB,ARCHIVE:archive()},scope={cutoff:'2026-10-15T00:00:00Z',limit:10};
 const preview=await compactPolymarketPayloadBatch(env,scope);assert.equal(preview.eligible,1);assert.equal(preview.updated,0);
 assert.equal(DB.sqlite.prepare('SELECT raw_payload_json FROM normalized_market_observations WHERE source=?').get('Polymarket US').raw_payload_json,s);
 const applied=await compactPolymarketPayloadBatch(env,{...scope,dryRun:false});assert.equal(applied.updated,1);assert.ok(applied.bytesRemoved>3000);
 const rows=DB.sqlite.prepare('SELECT * FROM normalized_market_observations ORDER BY id').all();assert.equal(rows.length,2);assert.equal(rows[0].contract_price,.6);assert.equal(rows[0].collected_at,'2026-10-14T12:00:00Z');assert.equal(rows[0].canonical_event_id,'event1');assert.equal(rows[1].raw_payload_json,s);
 assert.deepEqual(await restoreArchivedRaw(JSON.parse(rows[0].raw_payload_json),archive(),{storedHash:rows[0].raw_payload_hash}),raw);
 assert.equal((await compactPolymarketPayloadBatch(env,{...scope,dryRun:false})).updated,0);DB.sqlite.close();
});
test('cutoffs exclude future captures and malformed scopes or anonymous maintenance fail closed',async()=>{
 const env={DB:fixtureDb(),ARCHIVE:archive(),HARVEST_SECRET:'test'};
 await assert.rejects(compactPolymarketPayloadBatch(env,{cutoff:'bad'}),/INVALID/);
 await assert.rejects(compactPolymarketPayloadBatch(env,{cutoff:'2026-10-15',limit:501}),/INVALID/);
 const response=await onRequestPost({env,request:new Request('https://fbis/api/polymarket-storage',{method:'POST',body:JSON.stringify({operation:'compact',apply:true})})});assert.equal(response.status,403);env.DB.sqlite.close();
});

test('archive reconstruction preserves later derivation metadata without rewriting source evidence',async()=>{
 const c=(await compactArchivedRaw(raw,receipt)).raw;
 const derived={...c,identityLinkedAt:'2026-10-15T01:00:00Z',postCaptureIdentityLink:true};
 const restored=await restoreArchivedRaw(derived,archive(),{storedHash:await payloadHash(derived)});
 assert.equal(restored.identityLinkedAt,derived.identityLinkedAt);assert.equal(restored.postCaptureIdentityLink,true);
 assert.deepEqual(restored.providerMarket.marketSides,raw.providerMarket.marketSides);
});
