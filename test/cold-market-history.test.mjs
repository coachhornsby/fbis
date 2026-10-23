import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {onRequestGet,marketObservationPage} from '../functions/api/market-observations.js';
import {auditPlatformMarketCoverage,auditPartitionedMarketCoverage} from '../functions/lib/marketCoverageAudit.js';
import {coldMarketPartitions,marketObservationDatabase,readPartitionedMirrorCoverage,readColdCompatibleReconcilePage} from '../functions/lib/coldMarketHistory.js';
import {onRequestGet as cfbColdGet} from '../functions/api/cfb-cold-history.js';
import {onRequestPost as coldParityPost} from '../functions/api/market-cold-history.js';

function execute(path,sql,args=[]){
 const r=spawnSync('python3',['-c',`import sqlite3,json,sys\np=json.load(sys.stdin);c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row\nif p.get('script'):c.executescript(p['sql']);c.commit();print('[]')\nelse:\n q=c.execute(p['sql'],p['args']);out=[dict(r) for r in q];c.commit();print(json.dumps(out))`,path],{input:JSON.stringify(typeof sql==='object'?sql:{sql,args}),encoding:'utf8',maxBuffer:16*1024*1024});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
function db(path){return {prepare(sql){let args=[];const statement={bind(...a){args=a;return statement;},async all(){assert.match(sql.trimStart(),/^(SELECT|WITH|PRAGMA)/);return {results:execute(path,sql,args)};},async first(){return (await statement.all()).results[0]??null;}};return statement;}};}
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'cold-read-')),primary=join(dir,'primary.sqlite'),cold=join(dir,'cold.sqlite');
 const migration=await readFile(new URL('../migrations/0095_normalized_market_observation_ledger.sql',import.meta.url),'utf8'),schema=migration.match(/CREATE TABLE IF NOT EXISTS normalized_market_observations \([\s\S]*?\n\);/)[0];
 const columns=schema.split('\n').slice(1,-1).map(s=>s.trim().split(' ')[0]);
 const aux=`CREATE TABLE games(id TEXT,sport TEXT,start TEXT);INSERT INTO games VALUES('event','mlb','2026-10-16T18:00:00Z');CREATE TABLE tennis_official_matches(match_id TEXT,match_time TEXT);CREATE TABLE tennis_external_fixtures(fixture_id TEXT,match_time TEXT,source TEXT);`;
 for(const p of [primary,cold])execute(p,{sql:schema+aux,script:true});
 execute(cold,{script:true,sql:`CREATE TABLE storage_archive_acceptance(id TEXT PRIMARY KEY,state TEXT,source_upper_rowid INTEGER,source_rows INTEGER,research_rows INTEGER,drive_verified INTEGER,manifest_sha256 TEXT);INSERT INTO storage_archive_acceptance VALUES('market-20261017','COPY_VERIFIED',667201,667201,497624,1,'${'a'.repeat(64)}');`});
 const add=(rowid,extra={})=>{
  const row={...Object.fromEntries(columns.map(c=>[c,null])),id:'row'+rowid,observation_key:'key'+rowid,source:'PinnOdds',source_type:'bookmaker',sport:'mlb',canonical_event_id:'event',market_family:'moneyline',source_market_id:'m'+String(rowid).padStart(5,'0'),source_outcome_id:'home',side:'home',period:'full_game',line:0.5,decimal_odds:2.125,collected_at:'2026-10-15T06:00:00Z',created_at:'2026-10-15T06:00:00Z',event_start_time:'2026-10-16T18:00:00Z',snapshot_type:'RESEARCH',decision_eligible:0,can_qualify:0,can_authorize_wager:0,raw_payload_json:'{"sourceObservedAt":null,"quoteKind":"REFERENCE"}',...extra};
  const sql='INSERT INTO normalized_market_observations(rowid,'+columns.join(',')+') VALUES('+Array(columns.length+1).fill('?').join(',')+')',values=[rowid,...columns.map(c=>row[c])];execute(primary,sql,values);if(rowid<=667201)execute(cold,sql,values);return row;
 };
 return {dir,primary,cold,add,env:{DB:db(primary),COLD_HISTORY_DB:db(cold),COLD_MARKET_ARCHIVE_READS:'enabled'}};
}
function comparable(body){return {...body,rows:body.rows.map(r=>{const {displayCheckedAt,collectionLagMs,...temporal}=r.temporal;return {...r,temporal};})};}
test('real event DTO pages and coverage survive source retirement with no duplicates or clock changes',async()=>{
 const f=await fixture();try{
  for(let i=1;i<=105;i++)f.add(i,i===2?{source_observed_at:'2026-10-15T06:00:00Z',raw_payload_json:'{"sourceObservedAt":"2026-10-15T06:00:00Z"}'}:i===3?{raw_payload_json:'not-json'}:i===4?{raw_payload_json:'{"sourceObservedAt":false,"quoteKind":false,"priceKind":"REFERENCE"}'}:{});
  f.add(110,{source:'Polymarket US WebSocket',source_market_id:'retained',snapshot_type:'CURRENT',contract_price:.6,raw_payload_json:'{"sourceObservedAt":null}'});
  f.add(111,{source:'PrizePicks GitHub Mirror',source_market_id:'mirror',raw_payload_json:'{}'});
  f.add(667202,{source_market_id:'m00001',collected_at:'2026-10-17T00:00:00Z',created_at:'2026-10-17T00:00:00Z',decimal_odds:1.75});
  const request=cursor=>new Request('https://fbis.test/api/market-observations?sport=mlb&eventId=event&cursor='+cursor);
  const baseline=[];for(const cursor of [0,100]){const r=await onRequestGet({env:{DB:f.env.DB},request:request(cursor)});assert.equal(r.status,200);baseline.push(comparable(await r.json()));}
  const options={now:new Date('2026-10-17T03:00:00Z'),lookbackHours:48,sports:['mlb']},coverage=await auditPlatformMarketCoverage(f.env.DB,options);
  const historical=await marketObservationPage({DB:f.env.DB},{sport:'mlb',eventId:'event',now:new Date('2026-10-15T06:05:00Z')});
  const mirror=execute(f.primary,'SELECT COUNT(*) n,MAX(collected_at) collected_at,MAX(source_observed_at) observed_at FROM normalized_market_observations WHERE source=? AND sport=?',['PrizePicks GitHub Mirror','mlb'])[0];
  execute(f.primary,"DELETE FROM normalized_market_observations WHERE snapshot_type='RESEARCH' AND rowid<=667201");
  for(const [i,cursor] of [0,100].entries()){const r=await onRequestGet({env:f.env,request:request(cursor)});assert.equal(r.status,200);assert.deepEqual(comparable(await r.json()),baseline[i]);}
  assert.deepEqual((await auditPartitionedMarketCoverage(f.env,options)).sports,coverage.sports);
  assert.deepEqual(await marketObservationPage(f.env,{sport:'mlb',eventId:'event',now:new Date('2026-10-15T06:05:00Z')}),historical);
  assert.deepEqual(await readPartitionedMirrorCoverage(f.env,'PrizePicks GitHub Mirror','mlb'),mirror);
  assert.equal(execute(f.primary,"SELECT COUNT(*) n FROM normalized_market_observations WHERE snapshot_type='CURRENT'")[0].n,1);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('private cold-history readers reject anonymous access and exclude protected 2004 scope',async()=>{
 let queries=0;const env={HARVEST_SECRET:'fixture',COLD_HISTORY_DB:{prepare(){queries++;throw Error('must not query');}}};
 assert.equal((await cfbColdGet({env,request:new Request('https://fbis.test/api/cfb-cold-history?season=2005')})).status,403);
 assert.equal((await cfbColdGet({env,request:new Request('https://fbis.test/api/cfb-cold-history?season=2004',{headers:{'x-harvest-secret':'fixture'}})})).status,400);
 assert.equal((await coldParityPost({env,request:new Request('https://fbis.test/api/market-cold-history',{method:'POST',body:'{"operation":"verify"}'})})).status,403);
 assert.equal(queries,0);
});
test('cold gate rejects an unverified independent backup, and current writes remain primary',async()=>{
 const f=await fixture();try{
  // Research history must never spill into primary or a full/unverified legacy shard.
  await assert.rejects(marketObservationDatabase(f.env,'2026-10-17T02:00:00Z'),/MARKET_HISTORY_UNBOUND/);
  assert.equal(await marketObservationDatabase(f.env,'2026-10-15T02:00:00Z'),f.env.COLD_HISTORY_DB);
  assert.equal(await marketObservationDatabase(f.env,'2026-10-15T02:00:00Z','CURRENT'),f.env.DB);
  const history={prepare(){return {};}};
  await assert.rejects(marketObservationDatabase({...f.env,MARKET_HISTORY_DB:history},'2026-10-17T02:00:00Z','RESEARCH'),/FAIL_CLOSED/);
  assert.equal(await marketObservationDatabase({...f.env,MARKET_HISTORY_DB:history},'2026-10-17T02:00:00Z','CURRENT'),f.env.DB);
  // Capacity is verified from D1 query metadata, not a synthetic row count.
  const partition=(size)=>({prepare(sql){
    if(sql.includes('sqlite_master'))return {bind(){return {async first(){return {ok:1};}};}};
    if(sql.includes('SELECT 1 AS healthy'))return {async all(){return {meta:size==null?{}:{size_after:size}};}};
    throw Error('unexpected probe');
  }});
  const q4=partition(1_000_000_000);
  assert.equal(await marketObservationDatabase({...f.env,MARKET_HISTORY_2026Q4_DB:q4},'2026-10-23T06:00:00Z','RESEARCH'),q4);
  await assert.rejects(marketObservationDatabase({...f.env,MARKET_HISTORY_2026Q4_DB:partition(8_600_000_000)},'2026-10-23T06:00:00Z','RESEARCH'),/FAIL_CLOSED/);
  await assert.rejects(marketObservationDatabase({...f.env,MARKET_HISTORY_2026Q4_DB:partition(null)},'2026-10-23T06:00:00Z','RESEARCH'),/FAIL_CLOSED/);
  execute(f.cold,"UPDATE storage_archive_acceptance SET drive_verified=0");
  await assert.rejects(coldMarketPartitions(f.env),/NOT_QUALIFIED/);
  assert.equal((await coldMarketPartitions({DB:f.env.DB})).length,1);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('cross-partition reconciliation suppresses superseded unmatched records and keeps cursor progress',async()=>{
 const f=await fixture();try{
  f.add(1,{id:'a-old',sport:'soccer',canonical_event_id:null,source_market_id:'contract1',event_start_time:'2026-10-18T12:00:00Z'});
  f.add(2,{id:'b-old',sport:'soccer',canonical_event_id:null,source_market_id:'contract2',event_start_time:'2026-10-18T12:00:00Z'});
  f.add(667202,{id:'c-matched',sport:'soccer',canonical_event_id:'soccer-event',source_market_id:'contract1',event_start_time:'2026-10-18T12:00:00Z',collected_at:'2026-10-17T00:00:00Z'});
  execute(f.primary,"DELETE FROM normalized_market_observations WHERE snapshot_type='RESEARCH' AND rowid<=667201");
  const options={from:'2026-10-16',until:'2026-10-25',now:'2026-10-17T03:00:00Z',afterId:'',limit:1};
  const a=await readColdCompatibleReconcilePage(f.env,options);assert.equal(a.rows.length,0);assert.equal(a.nextCursor,'a-old');
  const b=await readColdCompatibleReconcilePage(f.env,{...options,afterId:a.nextCursor});assert.equal(b.rows[0].id,'b-old');assert.equal(b.rows[0].collected_at,'2026-10-15T06:00:00Z');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
