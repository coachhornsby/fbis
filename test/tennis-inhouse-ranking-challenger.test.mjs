import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {inhouseRankProbability,validateRankForecast,createInhouseRankChallenger,
 inspectInhouseRankChallenger} from '../functions/lib/tennisInhouseRankChallenger.js';
import {onRequestGet,onRequestPost} from '../functions/api/tennis-inhouse-rank-challenger.js';
const now=new Date('2026-10-23T12:00:00Z');
const event={tour:'wta',source:'WTA_OFFICIAL',
 player1_id:'tennis:wta:1',player2_id:'tennis:wta:2',
 event_start_time:'2026-10-24T12:00:00Z'};
const one={observation_id:'r1',fbis_player_id:event.player1_id,tour:'wta',
 source:'WTA_OFFICIAL',singles_rank:10,ranking_date:'2026-10-19',
 observed_at:'2026-10-20T00:00:00Z'};
const two={...one,observation_id:'r2',fbis_player_id:event.player2_id,singles_rank:40};
test('pre-registered rank formula is symmetric and has no third-party deep data',()=>{
 assert.equal(inhouseRankProbability(10,10),.5);
 assert.equal(inhouseRankProbability(10,40)+inhouseRankProbability(40,10),1);
 assert.equal(inhouseRankProbability('',10),null);
 assert.equal(inhouseRankProbability(10,20,{exponent:2}),null);
 const r=validateRankForecast(event,one,two,{now});
 assert.equal(r.ok,true);
 assert.equal(r.usesRestrictedDeepProfiles,false);
 assert.equal(r.usesMarketPrices,false);
 assert.equal(r.canQualify,false);
 assert.equal(r.canAuthorizeWager,false);
 assert.equal(r.rightsStatus,'REVIEW_REQUIRED');
});
test('future ranking revisions and stale observations cannot feed prematch probability',()=>{
 assert.equal(validateRankForecast(event,{...one,observed_at:'2026-10-24T20:00:00Z'},two,{now}).ok,false);
 assert.equal(validateRankForecast(event,{...one,ranking_date:'2026-10-25'},two,{now}).ok,false);
 assert.equal(validateRankForecast(event,{...one,observed_at:'2026-09-01'},two,{now}).ok,false);
 assert.equal(validateRankForecast(event,{...one,fbis_player_id:'wrong'},two,{now}).ok,false);
 assert.equal(validateRankForecast(event,{...one,source:'SACKMANN_TENNIS_ABSTRACT_RESEARCH'},two,{now}).ok,false);
 assert.equal(validateRankForecast({...event,event_start_time:'2026-10-23T00:00:00Z'},one,two,{now}).ok,false);
});
function fixtureDb(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT)');
 for(const name of ['0073_tennis_canonical_player_bank.sql',
  '0094_tennis_wta_match_history_pit.sql',
  '0123_tennis_inhouse_rank_challenger.sql']){
  sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 }
 for(const [id,name] of [['1','Player One'],['2','Player Two']]){
  const fbis='tennis:wta:'+id;
  sql.prepare(`INSERT INTO tennis_players(fbis_player_id,tour,canonical_name,normalized_name,created_at,updated_at)
   VALUES(?,'wta',?,?,?,?)`).run(fbis,name,name.toLowerCase(),now.toISOString(),now.toISOString());
  sql.prepare(`INSERT INTO tennis_player_source_ids(provider,source_player_id,fbis_player_id,first_seen_at,last_seen_at)
   VALUES('WTA_OFFICIAL',?,?,?,?)`).run(id,fbis,now.toISOString(),now.toISOString());
  sql.prepare(`INSERT INTO tennis_ranking_observations
    (observation_id,fbis_player_id,tour,ranking_date,singles_rank,source,observed_at,ingested_at)
    VALUES (?,?,'wta','2026-10-19',?,'WTA_OFFICIAL','2026-10-20T00:00:00Z','2026-10-20T00:00:00Z')`)
   .run('r'+id,fbis,id==='1'?10:40);
 }
 sql.prepare(`INSERT INTO tennis_official_matches
  (match_id,tour,source,source_match_id,tournament_name,tournament_level,
   match_time,surface,player1_id,player2_id,completion_state,observed_at,ingested_at,provenance_json)
  VALUES('event','wta','WTA_OFFICIAL','2026|123|AB01','Example Cup','WTA 250',
   '2026-10-24T12:00:00Z','hard','tennis:wta:1','tennis:wta:2',
   'SCHEDULED','2026-10-22T00:00:00Z','2026-10-22T00:00:00Z','{}')`).run();
 const db={prepare(q){const statement=sql.prepare(q);return {bind(...p){
  return {first:async()=>statement.get(...p)||null,
   all:async()=>({results:statement.all(...p)}),
   run:async()=>({meta:{changes:statement.run(...p).changes}})};
 }}}};
 return {db,sql};
}
test('real D1 schema freezes one pre-event independent forecast and never authorizes bets',async()=>{
 const {db,sql}=fixtureDb();
 const first=await createInhouseRankChallenger(db,{now});
 assert.equal(first.candidates,1);
 assert.equal(first.inserted,1);
 assert.equal(first.results[0].probabilityP1,inhouseRankProbability(10,40));
 const second=await createInhouseRankChallenger(db,{now:new Date(+now+3600000)});
 assert.equal(second.inserted,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM tennis_inhouse_rank_challenger').get().n,1);
 const saved=sql.prepare('SELECT * FROM tennis_inhouse_rank_challenger').get();
 assert.equal(saved.can_authorize_wager,0);
 assert.equal(saved.can_qualify,0);
 assert.equal(saved.source_rights_status,'REVIEW_REQUIRED');
 assert.throws(()=>sql.prepare('UPDATE tennis_inhouse_rank_challenger SET can_authorize_wager=1').run());
 const grade=await inspectInhouseRankChallenger(db,{now});
 assert.equal(grade.cohorts.wta.frozenSnapshots,1);
 assert.equal(grade.cohorts.wta.settledMatches,0);
 assert.equal(grade.promotionReady,false);
 sql.close();
});
test('no harvest token cannot write or read the protected challenger',async()=>{
 const env={HARVEST_SECRET:'example-secret'};
 const q={request:new Request('https://example.test/api/tennis-inhouse-rank-challenger'),env};
 assert.equal((await onRequestGet(q)).status,403);
 assert.equal((await onRequestPost(q)).status,403);
});
