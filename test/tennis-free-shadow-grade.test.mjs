import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {gradeFrozenTennisSnapshot,summarizeFrozenTennisGrades}
 from '../functions/lib/tennisFreeShadowGrade.js';
import {captureTennisFreeGrades,inspectTennisFreeGrades}
 from '../functions/lib/tennisFreeShadowGradingCapture.js';
import {FREE_TENNIS_SHADOW_VERSION}
 from '../functions/lib/tennisFreeShadowModel.js';
const t='2026-10-25T22:27:01.045Z',start='2026-10-26T02:30:00.000Z',
 observed='2026-10-26T08:08:01.985Z',hash='a'.repeat(64);
const f={snapshot_id:'snap-1',canonical_event_id:'match-1',tour:'wta',
 model_id:FREE_TENNIS_SHADOW_VERSION,player1_id:'p1',player2_id:'p2',
 p1_win:.495, p2_win:.505,forecast_at:t,event_start_time:start,
 event_observed_at:'2026-10-25T19:37:01.067Z',
 event_source:'WTA_OFFICIAL',calibrated:0,decision_eligible:0,
 contract_trading_authorized:0,input_hash:'b'.repeat(64)};
const m={match_id:'match-1',tour:'wta',source:'WTA_OFFICIAL',
 player1_id:'p1',player2_id:'p2',source_match_id:'2026|1056|LS025',
 source_player1_id:'wta-p1',source_player2_id:'wta-p2',
 winner_id:'p2',source_winner_id:'wta-p2',
 completion_state:'FINAL',result_reason:'OFFICIAL_COMPLETED_SETS',
 score_text:'6-0,7-5',sets_json:'[[0,6],[5,7]]',player1_sets:0,player2_sets:2,
 raw_artifact_key:'tennis/wta/official-results/raw/'+hash+'.json',
 provenance_json:JSON.stringify({source:'WTA_OFFICIAL',rawHash:hash,
  rawKey:'tennis/wta/official-results/raw/'+hash+'.json',
  sourceMatchId:'2026|1056|LS025'}),observed_at:observed,
 p1_name:'Daria Kasatkina',p2_name:'Talia Gibson'};
const v2={id:'v2-1',canonical_event_id:'match-1',tour:'wta',
 player1:'Daria Kasatkina',player2:'Talia Gibson',
 snapshot_type:'PURE_FIXTURE',pure_model_id:'TENNIS-FBIS-v2-CONTEXT',
 pure_p1:.45,decision_timestamp:'2026-10-25T22:01:00Z',
 event_start_time:start,can_authorize_wager:0};
const rank={snapshot_id:'rank-1',canonical_event_id:'match-1',tour:'wta',
 player1_id:'p1',player2_id:'p2',model_id:'TENNIS-INHOUSE-RANK-BASELINE-v1',
 p1_win:.4,forecast_at:'2026-10-25T22:11:00Z',
 event_start_time:start,rank_observed1_at:'2026-10-25T20:00:00Z',
 rank_observed2_at:'2026-10-25T20:00:00Z',can_authorize_wager:0};
test('official result evidence and immutable pre-start snapshot create a comparable receipt',()=>{
 const g=gradeFrozenTennisSnapshot(f,m,{v2:[v2],ranking:[rank]});
 assert.equal(g.ok,true);assert.equal(g.y,0);
 assert.equal(g.fullyPaired,true);
 assert.equal(g.challenger.brier,.495**2);
 assert.equal(g.champion.brier,.45**2);
 assert.equal(g.ranking.brier,.4**2);
 assert.equal(g.contractTradingAuthorized,false);
});
test('unmatched baselines remain null, not invented from the market',()=>{
 const g=gradeFrozenTennisSnapshot(f,m);
 assert.equal(g.ok,true);assert.equal(g.fullyPaired,false);
 assert.equal(g.champion,null);assert.equal(g.ranking,null);
 const x=gradeFrozenTennisSnapshot(f,m,{v2:[{...v2,
  decision_timestamp:'2026-10-26T03:00:00Z'}],ranking:[rank]});
 assert.equal(x.ok,true);assert.equal(x.champion,null);assert.equal(x.fullyPaired,false);
});
test('invalid winner, third-party result, time and source identity all fail closed',()=>{
 for(const bad of [
  {...m,completion_state:'SCHEDULED'},
  {...m,result_reason:null},
  {...m,raw_artifact_key:'tennis/third-party/results'},
  {...m,source_winner_id:'wta-p1'},
  {...m,provenance_json:'{}'},
  {...m,observed_at:'2026-10-25T22:00:00Z'},
  {...m,source:'ESPN'},
  {...m,player2_id:'wrong'},
  {...m,score_text:null},
 ]){
  assert.equal(gradeFrozenTennisSnapshot(f,bad).ok,false);
 }
 assert.equal(gradeFrozenTennisSnapshot({...f,
  forecast_at:'2026-10-26T03:00:00Z'},m).ok,false);
});
const asD1=db=>({prepare(sql){const stmt=db.prepare(sql);return {
  bind(...args){return {
   first:async()=>stmt.get(...args)||null,
   all:async()=>({results:stmt.all(...args)}),
   run:async()=>({meta:{changes:stmt.run(...args).changes}})
  }},
  first:async()=>stmt.get()||null,
  all:async()=>({results:stmt.all()}),
  run:async()=>({meta:{changes:stmt.run().changes}})
 } }});
test('separate PRIMARY settlement and TENNIS_DB immutable grade capture is idempotent',async()=>{
 const primary=new DatabaseSync(':memory:'),sport=new DatabaseSync(':memory:');
 try{
  primary.exec(`CREATE TABLE tennis_players(fbis_player_id TEXT PRIMARY KEY,canonical_name TEXT);
   CREATE TABLE tennis_official_matches(match_id TEXT PRIMARY KEY,tour TEXT,source TEXT,
   player1_id TEXT,player2_id TEXT,source_match_id TEXT,source_player1_id TEXT,
   source_player2_id TEXT,winner_id TEXT,source_winner_id TEXT,completion_state TEXT,
   result_reason TEXT,score_text TEXT,sets_json TEXT,player1_sets INTEGER,
   player2_sets INTEGER,raw_artifact_key TEXT,provenance_json TEXT,observed_at TEXT);
   CREATE TABLE tennis_v2_research_decisions(id TEXT PRIMARY KEY,canonical_event_id TEXT,
   tour TEXT,player1 TEXT,player2 TEXT,snapshot_type TEXT,pure_model_id TEXT,
   pure_p1 REAL,can_authorize_wager INTEGER,decision_timestamp TEXT,event_start_time TEXT);
   CREATE TABLE tennis_inhouse_rank_challenger(snapshot_id TEXT PRIMARY KEY,
   canonical_event_id TEXT,tour TEXT,player1_id TEXT,player2_id TEXT,model_id TEXT,
   p1_win REAL,can_authorize_wager INTEGER,rank_observed1_at TEXT,
   rank_observed2_at TEXT,forecast_at TEXT,event_start_time TEXT);`);
  primary.prepare('INSERT INTO tennis_players VALUES (?,?)').run('p1',m.p1_name);
  primary.prepare('INSERT INTO tennis_players VALUES (?,?)').run('p2',m.p2_name);
  const mc=Object.keys(m).filter(k=>!['p1_name','p2_name'].includes(k));
  primary.prepare(`INSERT INTO tennis_official_matches(${mc.join(',')})
   VALUES(${mc.map(()=>'?').join(',')})`).run(...mc.map(k=>m[k]));
  const vc=Object.keys(v2);
  primary.prepare(`INSERT INTO tennis_v2_research_decisions(${vc.join(',')})
   VALUES(${vc.map(()=>'?').join(',')})`).run(...vc.map(k=>v2[k]));
  const rc=Object.keys(rank);
  primary.prepare(`INSERT INTO tennis_inhouse_rank_challenger(${rc.join(',')})
   VALUES(${rc.map(()=>'?').join(',')})`).run(...rc.map(k=>rank[k]));
  sport.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT)');
  sport.exec('CREATE TABLE tennis_free_shadow_forecasts(snapshot_id TEXT PRIMARY KEY)');
  sport.exec(readFileSync(new URL('../migrations/0128_tennis_free_shadow_grades.sql',import.meta.url),'utf8'));
  const fc=Object.keys(f);
  sport.prepare(`INSERT INTO tennis_free_shadow_forecasts(${fc.join(',')})
   VALUES(${fc.map(()=>'?').join(',')})`);
  sport.exec('DROP TABLE tennis_free_shadow_forecasts');
  sport.exec(`CREATE TABLE tennis_free_shadow_forecasts(
   snapshot_id TEXT PRIMARY KEY,canonical_event_id TEXT,tour TEXT,model_id TEXT,
   player1_id TEXT,player2_id TEXT,p1_win REAL,p2_win REAL,
   forecast_at TEXT,event_start_time TEXT,event_observed_at TEXT,event_source TEXT,
   calibrated INTEGER,decision_eligible INTEGER,contract_trading_authorized INTEGER,
   input_hash TEXT)`);
  sport.prepare(`INSERT INTO tennis_free_shadow_forecasts(${fc.join(',')})
   VALUES(${fc.map(()=>'?').join(',')})`).run(...fc.map(k=>f[k]));
  const env={DB:asD1(primary),TENNIS_DB:asD1(sport),
   TENNIS_FREE_SHADOW_ENABLED:'true'};
  const first=await captureTennisFreeGrades(env,{now:new Date('2026-10-26T12:00:00Z')});
  assert.equal(first.ok,true);
  assert.equal(first.graded,1);
  assert.equal(first.fullyPairedNew,1);
  assert.equal(first.readback.cohorts.wta.graded,1);
  const again=await captureTennisFreeGrades(env,{now:new Date('2026-10-26T12:00:01Z')});
  assert.equal(again.graded,0);
  assert.equal((await inspectTennisFreeGrades(env.TENNIS_DB)).total.fullyPaired,1);
  assert.throws(()=>sport.exec("UPDATE tennis_free_shadow_grades SET challenger_p1=.2"));
  assert.throws(()=>sport.exec('DELETE FROM tennis_free_shadow_grades'));
 }finally{primary.close();sport.close()}
});
test('empty grades do not fabricate performance metrics',()=>{
 const s=summarizeFrozenTennisGrades([]);
 assert.equal(s.total.graded,0);assert.equal(s.cohorts.wta.paired.v2Brier,null);
 assert.equal(s.promotionReady,false);
});
