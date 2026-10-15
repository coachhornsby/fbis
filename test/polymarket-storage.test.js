import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {compactArchivedRaw,restoreArchivedRaw,payloadHash,receiptKey,compactPolymarketPayloadBatch} from '../functions/lib/polymarketPayloadArchive.js';
import {polymarketUsMarketFamily,polymarketUsPeriod,polymarketUsSideLabel} from '../functions/lib/polymarketUs.js';
import {onRequestPost} from '../functions/api/polymarket-storage.js';
import {compactUpdateSql} from '../scripts/lib/polymarket-storage-sql.mjs';
const rawKey='market-sources/polymarket-us/raw/'+'a'.repeat(64)+'.json';
const raw={receiptId:'fixture-123',rawSnapshotKey:rawKey,providerMarketId:'market1',providerOutcomeId:'yes1',providerTitle:'Home vs Away',contractLong:true,sourceObservedAt:null,quoteProvenance:'collector-capture-only',providerMarket:{id:'market1',sportsMarketType:'soccer_team_full_time_winner',sportsMarketTypeV2:'SPORTS_MARKET_TYPE_MONEYLINE',title:'Home (Reg. Time)',description:'Full settlement rules remain available',marketSides:[{id:'yes1',quote:.6,long:true,team:{name:'Home'},branding:'x'.repeat(2000)},{id:'no1',quote:.4,long:false,team:{name:'Away'},branding:'y'.repeat(2000)}]},providerSide:{id:'yes1',long:true,team:{name:'Home'},quote:.6}};
const receipt={receiptId:raw.receiptId,rawKey,offers:[{raw}]};
const archive=(r=receipt)=>({async get(k){assert.equal(k,receiptKey(raw.receiptId));return r?{size:JSON.stringify(r).length,async json(){return structuredClone(r)}}:null;}});
test('authorized receipt transport streams original bytes without parsing and rejects arbitrary keys',async()=>{
 let reads=0;const text=JSON.stringify(receipt),env={HARVEST_SECRET:'test',ARCHIVE:{async get(k){reads++;assert.equal(k,receiptKey(raw.receiptId));return {size:Buffer.byteLength(text),body:new Response(text).body,json(){throw Error('must not parse in Pages')}}}}};
 const request=(body,auth=true)=>new Request('https://fbis/api/polymarket-storage',{method:'POST',headers:auth?{'x-harvest-secret':'test'}:{},body:JSON.stringify(body)});
 assert.equal((await onRequestPost({env,request:request({operation:'receipt',receiptId:raw.receiptId},false)})).status,403);assert.equal(reads,0);
 const response=await onRequestPost({env,request:request({operation:'receipt',receiptId:raw.receiptId})});assert.equal(response.status,200);assert.equal(await response.text(),text);assert.equal(reads,1);
 assert.equal((await onRequestPost({env,request:request({operation:'receipt',receiptId:'../../private'})})).status,400);assert.equal(reads,1);
 assert.equal((await onRequestPost({env:{...env,ARCHIVE:{get:async()=>null}},request:request({operation:'receipt',receiptId:raw.receiptId})})).status,404);
 assert.equal((await onRequestPost({env:{...env,ARCHIVE:{get:async()=>({size:129*1024*1024})}},request:request({operation:'receipt',receiptId:raw.receiptId})})).status,413);
});
test('runner SQL round-trips quotes and Unicode, preserves other rows, and retains compare-and-swap',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE normalized_market_observations(id TEXT PRIMARY KEY,raw_payload_json TEXT,raw_payload_hash TEXT)');
 const id="quote'; DROP TABLE normalized_market_observations;--",text=JSON.stringify({name:"O'Brien 🏀",value:"'; DELETE FROM normalized_market_observations;--"});
 db.prepare('INSERT INTO normalized_market_observations VALUES(?,?,?)').run(id,'old','oldhash');db.prepare('INSERT INTO normalized_market_observations VALUES(?,?,?)').run('other','retain','retainhash');
 const statement=compactUpdateSql({id,text,hash:'newhash',oldHash:'oldhash'});db.exec(statement);assert.equal(db.prepare('SELECT raw_payload_json FROM normalized_market_observations WHERE id=?').get(id).raw_payload_json,text);
 assert.equal(db.prepare('SELECT raw_payload_json FROM normalized_market_observations WHERE id=?').get('other').raw_payload_json,'retain');
 db.exec(compactUpdateSql({id,text:'bad',hash:'bad',oldHash:'oldhash'}));assert.equal(db.prepare('SELECT raw_payload_json FROM normalized_market_observations WHERE id=?').get(id).raw_payload_json,text);
 assert.throws(()=>compactUpdateSql({id,text:'x'.repeat(100000),hash:'h',oldHash:'old'}),/TOO_LARGE/);db.close();
});
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
 const queries=[];return {sqlite,queries,prepare(sql){queries.push(sql);return {bind(...args){return {async all(){return {results:sqlite.prepare(sql).all(...args)}},async first(){return sqlite.prepare(sql).get(...args)},sql,args}}}},async batch(stmts){sqlite.exec('BEGIN');try{const result=stmts.map(s=>({meta:{changes:sqlite.prepare(s.sql).run(...s.args).changes}}));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
test('real SQLite migration is repeatable, dry-run safe and changes only the storage representation',async()=>{
 const DB=fixtureDb(),s=JSON.stringify(raw),h=await payloadHash(s);
 DB.sqlite.prepare('INSERT INTO normalized_market_observations VALUES(?,?,?,?,?,?,?)').run('nmo_'+'1'.repeat(28),'Polymarket US','2026-10-14T12:00:00Z',.6,'event1',s,h);
 DB.sqlite.prepare('INSERT INTO normalized_market_observations VALUES(?,?,?,?,?,?,?)').run('nmo_'+'2'.repeat(28),'PinnOdds','2026-10-14T12:00:00Z',.7,'event2',s,h);
 const env={DB,ARCHIVE:archive()},scope={cutoff:'2026-10-15T00:00:00Z',limit:10};
 DB.sqlite.exec('CREATE INDEX source_idx ON normalized_market_observations(source)');
 const preview=await compactPolymarketPayloadBatch(env,scope);
 const scan=DB.queries.find(q=>q.includes('SELECT rowid storage_rowid'));
 const plan=DB.sqlite.prepare('EXPLAIN QUERY PLAN '+scan).all(0,scope.cutoff,10).map(p=>p.detail).join(' ');
 assert.match(plan,/INTEGER PRIMARY KEY/);assert.doesNotMatch(plan,/TEMP B-TREE/);assert.equal(preview.eligible,1);assert.equal(preview.updated,0);
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


test('source replay preserves property order when omitted arrays were not the last field',async()=>{
 const reordered={...raw,providerMarket:{marketSides:raw.providerMarket.marketSides,...Object.fromEntries(Object.entries(raw.providerMarket).filter(([k])=>k!=='marketSides'))}};
 const r={...receipt,offers:[{raw:reordered}]};
 const c=await compactArchivedRaw(reordered,r);assert.equal(c.changed,true);
 const restored=await restoreArchivedRaw(c.raw,archive(r));
 assert.equal(JSON.stringify(restored),JSON.stringify(reordered));
 assert.equal(await payloadHash(restored),await payloadHash(reordered));
});

test('large receipts stream selected offers without buffering the full body or losing UTF-8 escapes',async()=>{
 const {readReceiptMatches}=await import('../functions/lib/polymarketPayloadArchive.js');
 const unicode={...raw,providerTitle:'São Paulo — München "home" \\ path'};
 const doc={receiptId:raw.receiptId,rawKey,offers:[{raw:{...raw,providerMarketId:'unmatched'}},{raw:unicode}]};
 const bytes=new TextEncoder().encode(JSON.stringify(doc));let i=0,jsonCalled=false;
 const streamed={async get(){return {size:30*1024*1024,body:new ReadableStream({pull(c){if(i>=bytes.length)return c.close();c.enqueue(bytes.slice(i,i+7));i+=7;}}),async json(){jsonCalled=true;throw Error('must stream')}};}};
 const found=await readReceiptMatches(streamed,receiptKey(raw.receiptId),new Set([JSON.stringify([raw.providerMarketId,raw.providerOutcomeId])]));
 assert.equal(found.offers.length,1);assert.equal(jsonCalled,false);assert.equal(await payloadHash(found.offers[0].raw),await payloadHash(unicode));
 const c=await compactArchivedRaw(unicode,found);assert.equal(c.changed,true);
 i=0;assert.equal(await payloadHash(await restoreArchivedRaw(c.raw,streamed)),await payloadHash(unicode));
});

test('truncated or oversized receipt streams cannot authorize removal of inline evidence',async()=>{
 const {readReceiptMatches}=await import('../functions/lib/polymarketPayloadArchive.js');
 const target=new Set([JSON.stringify([raw.providerMarketId,raw.providerOutcomeId])]);
 await assert.rejects(readReceiptMatches({async get(){return {size:129*1024*1024}}},receiptKey(raw.receiptId),target),/TOO_LARGE/);
 await assert.rejects(readReceiptMatches({async get(){return {size:50,body:new Response('{"receiptId":"oops","offers":[').body}}},receiptKey(raw.receiptId),target));
});

test('a real receipt above the old 16 MB ceiling retains only the requested source offer',async()=>{
 const {readReceiptMatches}=await import('../functions/lib/polymarketPayloadArchive.js');
 const filler=new TextEncoder().encode(JSON.stringify({raw:{providerMarketId:'other',providerOutcomeId:'other',padding:'z'.repeat(32768)}})+',');
 let stage=0,n=0;const total=550;
 const body=new ReadableStream({pull(c){
  if(stage===0){c.enqueue(new TextEncoder().encode(JSON.stringify({receiptId:raw.receiptId,rawKey}).slice(0,-1)+',"offers":['));stage=1;return;}
  if(n++<total){c.enqueue(filler);return;}
  if(stage===1){c.enqueue(new TextEncoder().encode(JSON.stringify({raw})+']}'));stage=2;return;}c.close();
 }});
 const result=await readReceiptMatches({async get(){return {body,size:filler.length*total+10000}}},receiptKey(raw.receiptId),new Set([JSON.stringify([raw.providerMarketId,raw.providerOutcomeId])]));
 assert.equal(result.offers.length,1);assert.equal(await payloadHash(result.offers[0].raw),await payloadHash(raw));
});
