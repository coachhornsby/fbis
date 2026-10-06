import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { priorTeamState,priorParkState,buildReconstructedPregameSnapshot } from "../functions/lib/asianBaseballPregame.js";
import { temporalEligible,compareWalkForward } from "../functions/lib/asianBaseballBacktest.js";

const hist=[
  {league:"KBO",game_date:"2025-09-01",is_final:1,home_team_id:"kbo-lg",away_team_id:"kbo-doo",home_final_runs:5,away_final_runs:3,venue:"JAMSIL"},
  {league:"KBO",game_date:"2025-09-02",is_final:1,home_team_id:"kbo-doo",away_team_id:"kbo-lg",home_final_runs:2,away_final_runs:4,venue:"JAMSIL"},
  {league:"KBO",game_date:"2025-09-03",is_final:1,home_team_id:"kbo-nc",away_team_id:"kbo-doo",home_final_runs:6,away_final_runs:4,venue:"CHANGWON"},
];
test("prior team state uses only supplied prior finals",()=>{
  const s=priorTeamState(hist,"kbo-lg");
  assert.equal(s.games,2);assert.equal(s.runsPerGame,4.5);assert.equal(s.runsAllowedPerGame,2.5);
  assert.equal(s.advanced.ops,null);
});
test("park state shrinks small samples toward neutral",()=>{
  const p=priorParkState(hist,"JAMSIL",{shrinkGames:200});
  assert.equal(p.priorGameSample,2);assert.ok(p.shrunkFactor>0.99&&p.shrunkFactor<1.02);
});
test("reconstructed snapshot is pre-start and leaves unsupported features missing",()=>{
  const target={league:"KBO",canonical_game_id:"KBO-X",season:2025,game_date:"2025-09-04",scheduled_start:"2025-09-04T09:30:00Z",
    home_team_id:"kbo-lg",away_team_id:"kbo-doo",venue:"JAMSIL"};
  const s=buildReconstructedPregameSnapshot(target,hist,{cutoffMinutes:360});
  assert.equal(s.temporalEligible,1);assert.equal(s.starters.home,null);assert.equal(s.lineup.home,null);
  assert.ok(s.missingFlags.includes("starter_announcement_historical_asof_unavailable"));
  assert.equal(temporalEligible({start:s.scheduledStart,frozenAt:s.snapshotAt}),true);
  assert.equal(s.modelOutputs.v1.ok,true);assert.equal(s.modelOutputs.v2.ok,true);
});
test("controlled tiny sample cannot pass 500-game promotion gate",()=>{
  const rows=[{start:"2025-09-04T09:30:00Z",frozenAt:"2025-09-04T03:30:00Z",homeRuns:5,awayRuns:3,
    v1:{home:4,away:4,pHome:.5},v2:{home:4.5,away:3.5,pHome:.6}}];
  const r=compareWalkForward(rows,{minimumN:500});
  assert.equal(r.promotion.pass,false);assert.equal(r.promotion.checks.sampleSize,false);assert.equal(r.promotion.canAuthorize,false);
});
test("Phase 3 migration is additive and fail-closed",async()=>{
  const sql=await readFile(new URL("../migrations/0081_asian_baseball_pregame_foundation.sql",import.meta.url),"utf8");
  assert.match(sql,/asian_baseball_pregame_snapshots/);assert.match(sql,/asian_baseball_park_factors/);
  assert.match(sql,/temporal_eligible INTEGER NOT NULL DEFAULT 0/);assert.match(sql,/can_qualify INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql,/can_authorize INTEGER NOT NULL DEFAULT 0/);assert.doesNotMatch(sql,/\bDROP\b|\bDELETE FROM\b/i);
});
