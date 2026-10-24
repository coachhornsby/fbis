import test from "node:test";
import assert from "node:assert/strict";
import {simulateNflClockFieldResearch} from "../functions/lib/nflClockFieldSimulationResearch.js";
function historical(i,hasClocks=true){
 const drives=Array.from({length:20},(_,j)=>({
  driveId:"d"+i+"_"+j,seq:j+1,offense:j%2?"away":"home",
  period:1+Math.floor(j/5),plays:4,startYardsToGoal:70+j%15,startMargin:0,
  offensePoints:j%5===0?7:j%5===1?3:0,defensePoints:0,
  ...(hasClocks?{gameClockFirst:3500-j*150,gameClockLast:3440-j*150,
   clockSpanLowerBound:60}:{})
 }));
 return {gameId:"historical"+i,homeTeamId:"TEAM_A",awayTeamId:"TEAM_B",
  kickoff:"2025-09-01T16:00:00Z",gradedAt:"2025-09-01T20:00:00Z",
  observedAt:"2025-09-02T03:00:00Z",
  source:"NFL_PBP_VERIFIED_POSSESSIONS",sourceFingerprint:"fingerprint-"+i,
  drives,regulationOnly:true,officialScoreMatched:true};
}
const base={gameId:"future",snapshotId:"snap",frozenAt:"2026-10-23T17:00:00Z",
 kickoff:"2026-10-24T17:00:00Z",homeTeamId:"TEAM_A",awayTeamId:"TEAM_B",
 projectedHome:27,projectedAway:23,iterations:100,historicalReconstruction:true};
test("NFL clock-field candidate uses verified lower bounds and deterministic regulation draws",()=>{
 const hist=Array.from({length:34},(_,i)=>historical(i));
 const a=simulateNflClockFieldResearch({...base,trainingGames:hist});
 const b=simulateNflClockFieldResearch({...base,trainingGames:hist});
 assert.equal(a.distributions.home_score.mean,b.distributions.home_score.mean);
 assert.equal(a.clockedTrainingDrives,680);
 assert.equal(a.timeEvidence,"FIRST_TO_LAST_PLAY_CLOCK_SPAN_LOWER_BOUND");
 assert.equal(a.prospective,false);
 assert.equal(a.canAuthorizeWager,false);
 assert.equal(a.changesProductionChampion,false);
 assert.ok(a.distributions.drives.mean>=1);
});
test("NFL challenger fails closed rather than fabricating observed drive clocks",()=>{
 const hist=Array.from({length:34},(_,i)=>historical(i,false));
 assert.throws(()=>simulateNflClockFieldResearch({...base,trainingGames:hist}),
  /NFL_CLOCK_PLAY_TIMESTAMP_COVERAGE_INSUFFICIENT/);
 assert.throws(()=>simulateNflClockFieldResearch({...base,trainingGames:hist,
  frozenAt:"2026-10-25T00:00:00Z"}),/NFL_CLOCK_INVALID_BASELINE/);
});
