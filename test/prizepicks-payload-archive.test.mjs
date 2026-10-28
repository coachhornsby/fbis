import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {compactPrizePicksRaw,restorePrizePicksRaw,ppCompactionStatement,PP_INLINE_RAW_KEYS} from '../functions/lib/prizepicksPayloadArchive.js';
const id='a'.repeat(64),proof={id,driveFileId:'verified_Drive_file',sourceSqlSha256:'b'.repeat(64)};
const original=JSON.stringify({player_image:'https://example.test/player.png',league:'WTA',payout_break_even_probability:0,payout_calibration_validated:false,providerEvidence:'x'.repeat(3000),updated_at:'2026-10-01'});
test('archive view preserves every image, league and payout value including false and zero',async()=>{
 const all=Object.fromEntries(PP_INLINE_RAW_KEYS.map((k,i)=>[k,[false,0,null,'value'][i%4]]));const raw=JSON.stringify({...all,large:'x'.repeat(4000)});
 const c=await compactPrizePicksRaw(raw,proof);assert.equal(c.changed,true);for(const k of PP_INLINE_RAW_KEYS)assert.deepEqual(JSON.parse(c.text)[k],all[k]);
 assert.equal(await restorePrizePicksRaw(c.text,{id,raw_json:raw}),raw);
});
test('wrong archive identity, corrupted source and malformed proof fail closed',async()=>{
 const c=await compactPrizePicksRaw(original,proof);
 await assert.rejects(()=>restorePrizePicksRaw(c.text,{id:'c'.repeat(64),raw_json:original}),/IDENTITY/);
 await assert.rejects(()=>restorePrizePicksRaw(c.text,{id,raw_json:original+' '}),/HASH/);
 await assert.rejects(()=>compactPrizePicksRaw(original,{...proof,driveFileId:'../wrong'}),/PROOF/);
 assert.equal((await compactPrizePicksRaw(c.text,proof)).changed,false);
});
test('real SQLite update changes only raw_json, protects concurrent edits and uses primary-key lookups',async()=>{
 const c=await compactPrizePicksRaw(original,proof);const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE prizepicks_prop_lines(id TEXT PRIMARY KEY,raw_json TEXT,fbis_projection REAL,collected_at TEXT,feature_evidence_json TEXT)');
 db.prepare('INSERT INTO prizepicks_prop_lines VALUES(?,?,?,?,?)').run(id,original,0,'clock','frozen');
 const adapter={prepare(sql){return{bind(...args){return{sql,args,run(){return db.prepare(sql).run(...args)}}}}}};
 const stmt=ppCompactionStatement(adapter,[{id,oldRaw:original,newRaw:c.text}]);assert.match(db.prepare('EXPLAIN QUERY PLAN '+stmt.sql).all(...stmt.args).map(x=>x.detail).join(' '),/INDEX/);
 assert.equal(stmt.run().changes,1);assert.equal(stmt.run().changes,0);
 const row=db.prepare('SELECT * FROM prizepicks_prop_lines').get();assert.equal(row.fbis_projection,0);assert.equal(row.collected_at,'clock');assert.equal(row.feature_evidence_json,'frozen');assert.equal(await restorePrizePicksRaw(row.raw_json,{id,raw_json:original}),original);db.close();
});

test('the actual tennis headshot reader returns identical candidates from original and archived views',async()=>{
 const {loadPrizePicksTennisHeadshotCandidates}=await import('../functions/lib/tennisPrizePicksHeadshots.js');const c=await compactPrizePicksRaw(original,proof);
 const db=raw_json=>({prepare(){return{bind(){return this;},async all(){return{results:[{player_name:'Example Player',player_headshot_url:'https://example.test/player.png',league:null,collected_at:'2026-10-01',raw_json}]}}}}});
 assert.deepEqual(await loadPrizePicksTennisHeadshotCandidates(db(c.text)),await loadPrizePicksTennisHeadshotCandidates(db(original)));
});
