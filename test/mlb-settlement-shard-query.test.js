import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {MLB_SETTLEMENT_ROWS_SQL,MLB_SETTLEMENT_SHARD_VALUE} from '../functions/lib/mlbSettlementQuery.js';
import {onRequestPost} from '../functions/api/mlb-prop-evidence.js';

const legacy=(id,shard,shards)=>shards<=1 || (Number.isFinite(parseInt(String(id||'0').slice(0,8),16)) && parseInt(String(id||'0').slice(0,8),16)%shards===shard);
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE mlb_prop_prospective_evidence(id TEXT PRIMARY KEY,event_id TEXT,event_date TEXT,temporal_integrity INTEGER,settled_at TEXT,
 player_id TEXT,player_name TEXT,market TEXT,candidate_side TEXT,market_line REAL,market_json TEXT,market_source TEXT,sportsbook TEXT,duplicate_key TEXT,market_observed_at TEXT,
 actual_value REAL,result TEXT,settlement_source TEXT,settlement_json TEXT,updated_at TEXT,state_snapshot_json TEXT,projection_json TEXT);
 CREATE TABLE fbis_prospective_evidence(evidence_id TEXT PRIMARY KEY,graded_at TEXT,result_json TEXT);
 CREATE TABLE mlb_prop_evidence_runs(id TEXT,operation TEXT,event_date TEXT,shard REAL,shards REAL,status TEXT,attempted INTEGER,accepted INTEGER,duplicates INTEGER,rejected INTEGER,settled INTEGER,missing_outcomes INTEGER,started_at TEXT,finished_at TEXT,details_json TEXT);
 CREATE TABLE mlb_prop_evidence_rejections(id TEXT PRIMARY KEY,operation TEXT,event_id TEXT,player_id TEXT,player_name TEXT,market TEXT,reason TEXT,details_json TEXT,observed_at TEXT);`);
 const insert=sql.prepare(`INSERT INTO mlb_prop_prospective_evidence(id,event_id,event_date,temporal_integrity,settled_at,player_id,player_name,market,candidate_side,market_line,market_json,market_source,sportsbook,duplicate_key,market_observed_at,state_snapshot_json,projection_json) VALUES(?,?,?,1,NULL,'1','Fixture Player','hits','MORE',1.5,'{}','fixture','fixture',?,'2026-10-07T12:00:00Z',?,?)`);
 function add(id,event='849838',snapshot='{}'){insert.run(id,event,'2026-10-07',id,snapshot,'{}');sql.prepare('INSERT INTO fbis_prospective_evidence(evidence_id) VALUES(?)').run(id);}
 return {sql,add};
}
test('real SQLite predicate exactly matches legacy parser across malformed and hexadecimal IDs',()=>{
 const {sql,add}=fixture();
 const ids=['','0','nohex','fZ','FFFFFFFF','00000001','  +0xff','-0xFFzz','+f','-f','0x','+','-','😀fff','f😀fff','\u00a0ff','\ufeffa','\t-0xff','abcdef012345','Infinity','0000000g','12345678tail'];
 for(const w of ['\u1680','\u2000','\u200a','\u2028','\u2029','\u202f','\u205f','\u3000'])ids.push(w+'f');
 for(let i=0;i<2317;i++)ids.push(createHash('sha256').update(String(i)).digest('hex'));
 for(const id of ids)add(id);
 for(const shards of [1,2,12,32,2.5,2.3])for(let shard=0;shard<shards;shard++){
  const actual=sql.prepare(MLB_SETTLEMENT_ROWS_SQL).all('849838',shards,shards,shard).map(x=>x.id).sort();
  assert.deepEqual(actual,ids.filter(id=>legacy(id,shard,shards)).sort());
 }
 sql.close();
});
test('2317 rows partition once across 12 shards; selected payload omits unused snapshots',()=>{
 const {sql,add}=fixture();const ids=[];
 // Distinct ownership is by evidence identity, not player/game/market duplication.
 for(let i=0;i<2317;i++){const id=createHash('sha256').update(String(i)).digest('hex');ids.push(id);add(id,'849838','x'.repeat(96240));}
 add('other-game','849822');add('settled');add('ineligible');
 sql.exec("UPDATE mlb_prop_prospective_evidence SET settled_at='prior' WHERE id='settled'; UPDATE mlb_prop_prospective_evidence SET temporal_integrity=0 WHERE id='ineligible'");
 const seen=new Set(),counts=[];let bytes=0;
 const started=performance.now();
 for(let shard=0;shard<12;shard++){
  const rows=sql.prepare(MLB_SETTLEMENT_ROWS_SQL).all('849838',12,12,shard);counts.push(rows.length);bytes+=Buffer.byteLength(JSON.stringify(rows));
  for(const row of rows){assert.equal(row.event_id,'849838');assert.equal('state_snapshot_json' in row,false);assert.equal('projection_json' in row,false);assert.equal(seen.has(row.id),false);seen.add(row.id);}
 }
 assert.deepEqual([...seen].sort(),ids.sort());
 assert.equal(sql.prepare(MLB_SETTLEMENT_ROWS_SQL).all('missing',12,12,0).length,0);
 assert.throws(()=>add(ids[0]),/UNIQUE/);
 console.log(JSON.stringify({fixtureRows:2317,rowsReturnedPerShard:counts,totalReturned:seen.size,payloadBytesAcross12:bytes,queryCount:12,durationMs:performance.now()-started,legacyStateBytesPerShard:2317*96240}));
 sql.close();
});
function adapter(sql,{failRead=false,failWriteId=null}={}){
 const metrics={queries:0,returned:0};let failed=false;
 return {metrics,prepare(query){let args=[];return{bind(...values){args=values;return this;},async all(){metrics.queries++;if(query===MLB_SETTLEMENT_ROWS_SQL&&failRead&&!failed){failed=true;throw new Error('fixture read failure');}const rows=sql.prepare(query).all(...args);if(query===MLB_SETTLEMENT_ROWS_SQL)metrics.returned+=rows.length;return{results:rows};},async run(){if(query.includes('SET actual_value=')&&args.at(-1)===failWriteId&&!failed){failed=true;throw new Error('fixture partial write failure');}return{meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};}};
}
async function invoke(db,shard=0){
 return onRequestPost({env:{DB:db,HARVEST_SECRET:'fixture'},request:new Request('https://fixture/api/mlb-prop-evidence',{method:'POST',headers:{'x-harvest-secret':'fixture'},body:JSON.stringify({operation:'settle',date:'2026-10-07',shard,shards:12})})});
}
const feed={
 gameData:{status:{abstractGameState:'Final'}},
 liveData:{boxscore:{teams:{
  home:{players:{ID1:{person:{id:1,fullName:'Fixture Player'},stats:{batting:{hits:2}}}}},
  away:{players:{}}
 }}}
};
test('actual handler preserves grades, canonical lineage, idempotence and failed/read retry audit',async t=>{
 const {sql,add}=fixture();add('00000000'+'a'.repeat(56));add('00000001'+'b'.repeat(56));
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(feed),{status:200}));
 const db=adapter(sql,{failRead:true});
 const failed=await invoke(db);assert.equal(failed.status,500);assert.match((await failed.json()).error,/fixture read failure/);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM mlb_prop_evidence_runs WHERE status='FAILED'").get().n,1);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM mlb_prop_prospective_evidence WHERE settled_at IS NOT NULL').get().n,0);
 const retry=await (await invoke(db)).json();assert.equal(retry.settled,1);
 const row=sql.prepare("SELECT * FROM mlb_prop_prospective_evidence WHERE id LIKE '00000000%'").get();assert.equal(row.actual_value,2);assert.equal(row.result,'HIT');assert.equal(row.settlement_source,'MLB_STATS_FINAL');
 assert.equal(JSON.parse(sql.prepare('SELECT result_json FROM fbis_prospective_evidence WHERE evidence_id=?').get(row.id).result_json).result,'HIT');
 assert.equal((await (await invoke(db)).json()).settled,0);
 assert.equal((await (await invoke(db,1)).json()).settled,1);
 assert.equal(db.metrics.returned,2);
 sql.close();
});
test('partial shard failure retains successful rows; retry settles only remaining owned rows',async t=>{
 const {sql,add}=fixture();const a='00000000'+'a'.repeat(56),b='0000000c'+'b'.repeat(56);add(a);add(b);
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(feed),{status:200}));
 const db=adapter(sql,{failWriteId:b});
 assert.equal((await invoke(db)).status,500);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM mlb_prop_prospective_evidence WHERE settled_at IS NOT NULL').get().n,1);
 assert.equal((await (await invoke(db)).json()).settled,1);
 assert.equal((await (await invoke(db)).json()).settled,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM fbis_prospective_evidence WHERE graded_at IS NOT NULL').get().n,2);
 sql.close();
});
