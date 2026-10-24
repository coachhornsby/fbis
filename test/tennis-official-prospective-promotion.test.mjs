import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {verifyWtaOfficialFinal,reconcileWtaOfficialResults} from '../functions/lib/tennisOfficialResults.js';
import {classifyTennisPromotion,onRequestGet} from '../functions/api/tennis-promotion-readiness.js';
import {onRequestPost} from '../functions/api/tennis-official-outcome-reconcile.js';
const time='2026-10-23T20:00:00.000Z';
const t={tournamentGroup:{id:2092},year:2026};
const match={
 EventID:'2092',EventYear:2026,MatchID:'LS001',MatchState:'F',DrawMatchType:'S',
 PlayerIDA:'1001',PlayerIDB:'1002',ScoreString:'6-4 6-2',
 ScoreSet1A:6,ScoreSet1B:4,ScoreSet2A:6,ScoreSet2B:2
};
test('only official complete singles scores establish a winner',()=>{
 const ok=verifyWtaOfficialFinal(match,t);
 assert.equal(ok.verified,true);
 assert.equal(ok.sourceWinnerId,'1001');
 assert.deepEqual(ok.sets,[[6,4],[6,2]]);
 const changes=[
  {...match,MatchState:'U'},
  {...match,MatchState:'F',ScoreString:'6-4 RET'},
  {...match,ScoreString:''},
  {...match,ScoreSet1A:7,ScoreSet1B:7},
  {...match,ScoreSet2A:1,ScoreSet2B:0},
  {...match,WinnerID:'1002'},
  {...match,DrawMatchType:'D'},
  {...match,EventID:'1111'},
  {...match,PlayerIDA:'1002'}
 ];
 for(const row of changes)assert.equal(verifyWtaOfficialFinal(row,t).verified,false,JSON.stringify(row));
});
function inMemory(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE tennis_players(fbis_player_id TEXT PRIMARY KEY,canonical_name TEXT);
 CREATE TABLE tennis_official_matches(match_id TEXT PRIMARY KEY,source TEXT,tour TEXT,source_match_id TEXT,
 winner_id TEXT,source_winner_id TEXT,player1_id TEXT,player2_id TEXT,
 source_player1_id TEXT,source_player2_id TEXT,match_time TEXT,completion_state TEXT,
 score_text TEXT,sets_json TEXT,player1_sets INTEGER,player2_sets INTEGER,
 result_reason TEXT,provenance_json TEXT,raw_artifact_key TEXT,source_updated_at TEXT,observed_at TEXT);
 CREATE TABLE tennis_v2_research_decisions(canonical_event_id TEXT,snapshot_type TEXT,pure_model_id TEXT,
 graded_at TEXT,result_winner TEXT,pure_p1 REAL,decision_timestamp TEXT,event_start_time TEXT,
 player1 TEXT,player2 TEXT);`);
 sql.prepare('INSERT INTO tennis_players VALUES (?,?)').run('p1','Player One');
 sql.prepare('INSERT INTO tennis_players VALUES (?,?)').run('p2','Player Two');
 sql.prepare(`INSERT INTO tennis_official_matches(match_id,source,tour,source_match_id,
 player1_id,player2_id,source_player1_id,source_player2_id,match_time,completion_state)
 VALUES ('test','WTA_OFFICIAL','wta','2026|2092|LS001','p1','p2','1001','1002',
 '2026-10-23T15:00:00.000Z','FINAL')`).run();
 for(const [ts,start,model] of [
  ['2026-10-23T14:00:00Z','2026-10-23T15:00:00Z','TENNIS-FBIS-v2-CONTEXT'],
  ['2026-10-23T16:00:00Z','2026-10-23T15:00:00Z','TENNIS-FBIS-v2-CONTEXT'],
  ['2026-10-23T14:00:00Z','2026-10-23T15:00:00Z','OTHER-MODEL']
 ])sql.prepare(`INSERT INTO tennis_v2_research_decisions
 VALUES ('test','PURE_FIXTURE',?,NULL,NULL,.65,?,?, 'Player One','Player Two')`)
 .run(model,ts,start);
 return {sql,db:{prepare(q){const st=sql.prepare(q);return {bind(...args){
  return {all:async()=>({results:st.all(...args)}),
   run:async()=>({meta:{changes:st.run(...args).changes}})}
 }}}}};
}
test('signed official score evidence grades only pre-start v2 PURE decisions and remains idempotent',async()=>{
 const {sql,db}=inMemory(),saved=[];
 const payload={tournament:t,matches:[match]};
 const bucket={async put(key,raw){saved.push({key,raw})}};
 const run=()=>reconcileWtaOfficialResults(db,bucket,t,payload,{now:new Date(time)});
 const x=await run();
 assert.equal(x.resultsWritten,1);
 assert.equal(x.pureDecisionsGraded,1);
 assert.equal(x.canAuthorizeWager,false);
 assert.equal(x.marketIndependent,true);
 assert.equal(saved.length,1);
 assert.match(saved[0].key,/official-results\/raw\//);
 const row=sql.prepare('SELECT winner_id,source_winner_id,player1_sets,result_reason FROM tennis_official_matches').get();
 assert.equal(row.winner_id,'p1');
 assert.equal(row.source_winner_id,'1001');
 assert.equal(row.player1_sets,2);
 assert.equal(row.result_reason,'OFFICIAL_COMPLETED_SETS');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM tennis_v2_research_decisions WHERE result_winner IS NOT NULL').get().n,1);
 const repeat=await run();
 assert.equal(repeat.resultsWritten,0);
 assert.equal(repeat.pureDecisionsGraded,0);
 sql.close();
});
test('unverified score or mismatched canonical source IDs never writes result',async()=>{
 const {sql,db}=inMemory();
 const evidence={put:async()=>{}};
 const rejected=await reconcileWtaOfficialResults(db,evidence,t,{tournament:t,
  matches:[{...match,ScoreString:'6-4 RET'}]},{now:new Date(time)});
 assert.equal(rejected.resultsWritten,0);
 assert.equal(rejected.pureDecisionsGraded,0);
 assert.equal(sql.prepare('SELECT winner_id FROM tennis_official_matches').get().winner_id,null);
 sql.close();
});
test('unauthenticated outcomes and qualification certificates fail closed',async()=>{
 const env={HARVEST_SECRET:'x'.repeat(32)};
 const post=await onRequestPost({request:new Request('https://example.test/api/tennis-official-outcome-reconcile',{method:'POST'}),env});
 const get=await onRequestGet({request:new Request('https://example.test/api/tennis-promotion-readiness'),env});
 assert.equal(post.status,403);assert.equal(get.status,403);
});
test('promotion blocks missing ATP and WTA samples, commercial source restrictions and economic proof',()=>{
 const result=classifyTennisPromotion([
  {tour:'wta',decision_timestamp:'2026-10-23T12:00:00Z',
   event_start_time:'2026-10-23T15:00:00Z',pure_p1:.7,source:'WTA_OFFICIAL',
   completion_state:'FINAL',result_reason:'OFFICIAL_COMPLETED_SETS',
   raw_artifact_key:'tennis/wta/official-results/raw/digest.json',
   source_winner_id:'1001',winner_id:'p1',player1_id:'p1',player2_id:'p2',
   player1:'Player One',player2:'Player Two',canonical_p1:'Player One',
   canonical_p2:'Player Two',graded_at:'2026-10-23T20:00:00Z',result_winner:'Player One'}
 ],[{tour:'wta',rows:1000,source_license:'CC BY-NC-SA 4.0'}],[],{
  now:new Date('2026-10-24T00:00:00Z')});
 assert.equal(result.cohorts.wta.verifiedSettledMatches,1);
 assert.ok(result.cohorts.wta.matchBrier>0);
 assert.equal(result.sourceRights.noncommercialRestrictedRows,1000);
 assert.equal(result.promotionReady,false);
 assert.equal(result.commercialWagerAuthorization,false);
 assert.equal(result.gates.bothToursProspectiveSample,false);
 assert.equal(result.gates.productionProfileRights,false);
});
