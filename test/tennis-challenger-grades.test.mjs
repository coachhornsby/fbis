import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {scoreTennisRankSnapshot,gradeTennisRankingChallenger} from '../functions/lib/tennisChallengerGrades.js';
const base={tour:'wta',source:'WTA_OFFICIAL',completion_state:'FINAL',
 result_reason:'OFFICIAL_COMPLETED_SETS',source_winner_id:'1',winner_id:'p1',
 player1_id:'p1',player2_id:'p2',match_player1_id:'p1',match_player2_id:'p2',
 forecast_at:'2026-10-22T12:00:00Z',event_start_time:'2026-10-23T12:00:00Z',
 result_observed_at:'2026-10-23T15:00:00Z',
 raw_artifact_key:'tennis/wta/official-results/raw/sha.json',p1_win:.75};
test('strict temporal and raw official winner identity before grading',()=>{
 const s=scoreTennisRankSnapshot(base);
 assert.equal(s.ok,true);assert.equal(s.brier,.0625);assert.equal(s.hit,1);
 for(const row of [
  {...base,forecast_at:base.event_start_time},
  {...base,source:'ESPN'},
  {...base,raw_artifact_key:'tennis/wta/other.json'},
  {...base,result_reason:'RETIRED'},
  {...base,result_observed_at:'2026-10-22T10:00:00Z'},
  {...base,winner_id:'p3'},
  {...base,match_player1_id:'p3'}
 ])assert.equal(scoreTennisRankSnapshot(row).ok,false);
});
test('grades table immutable and unauthorized betting impossible',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=OFF;CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT);');
 db.exec(readFileSync(new URL('../migrations/0124_tennis_challenger_grades.sql',import.meta.url),'utf8'));
 db.prepare(`INSERT INTO tennis_inhouse_rank_grades
 (snapshot_id,canonical_event_id,tour,winner_id,result_raw_artifact_key,p1_win,
 actual_p1,brier,log_loss,hit,graded_at)
 VALUES('s1','e1','wta','p1','tennis/wta/official-results/raw/x',.75,1,.0625,.28768,1,'2026-10-23')`).run();
 assert.throws(()=>db.exec("UPDATE tennis_inhouse_rank_grades SET hit=0 WHERE snapshot_id='s1'"));
 assert.throws(()=>db.exec("DELETE FROM tennis_inhouse_rank_grades WHERE snapshot_id='s1'"));
 assert.throws(()=>db.exec("UPDATE tennis_inhouse_rank_grades SET can_authorize_wager=1 WHERE snapshot_id='s1'"));
 db.close();
});
