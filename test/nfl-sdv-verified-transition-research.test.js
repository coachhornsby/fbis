import test from "node:test";
import assert from "node:assert/strict";
import {
 parseNflSourcePossessionSeconds,parseNflSourceYardsToGoal,
 extractNflSourceDriveContext
} from "../functions/lib/nflSdvDriveContext.js";
import {simulateNflVerifiedDriveTransitionShadow,mapHistoricalNextOffenseToTarget} from "../functions/lib/nflSdvVerifiedTransitionResearch.js";
test("Official nflfastR possession time and team-relative yards parse without imputation",()=>{
 assert.equal(parseNflSourcePossessionSeconds("03:42"),222);
 assert.equal(parseNflSourcePossessionSeconds("1:07"),67);
 assert.equal(parseNflSourcePossessionSeconds("n/a"),null);
 assert.equal(parseNflSourcePossessionSeconds("25:99"),null);
 assert.equal(parseNflSourceYardsToGoal("TEN 35","HOU","HOU","TEN"),35);
 assert.equal(parseNflSourceYardsToGoal("HOU 35","HOU","HOU","TEN"),65);
 assert.equal(parseNflSourceYardsToGoal("MIDFIELD","HOU","HOU","TEN"),50);
 assert.equal(parseNflSourceYardsToGoal("XXX 35","HOU","HOU","TEN"),null);
 const source=[{drive_time_of_possession:"3:42",drive_start_transition:"Kickoff",
  drive_end_transition:"Punt",drive_start_yard_line:"HOU 25",
  drive_end_yard_line:"TEN 45"}];
 const context=extractNflSourceDriveContext(source,{home:"HOU",away:"TEN",offense:"HOU"});
 assert.equal(context.officialDurationSeconds,222);
 assert.equal(context.startTransition,"KICKOFF");
 assert.equal(context.endTransition,"PUNT");
 assert.equal(context.officialStartYardsToGoal,75);
 assert.equal(context.officialEndYardsToGoal,45);
});
test("Conflicting or absent source clock remains missing rather than guessed",()=>{
 const context=extractNflSourceDriveContext([
  {drive_time_of_possession:"3:42",drive_start_transition:"Punt"},
  {drive_time_of_possession:"4:17",drive_start_transition:"Punt"}],
  {home:"HOU",away:"TEN",offense:"HOU"});
 assert.equal(context.officialDurationSeconds,undefined);
 assert.equal(context.startTransition,"PUNT");
});
function historical(i,verified=true){
 const drives=Array.from({length:20},(_,j)=>({
  driveId:"drive"+i+"_"+j,seq:j+1,offense:j%2?"away":"home",
  period:1+Math.floor(j/5),plays:7,startYardsToGoal:70+j%20,startMargin:0,
  offensePoints:j%5===0?7:j%5===1?3:0,defensePoints:0,
  ...(verified?{
   officialDurationSeconds:160+j%5*7,officialStartYardsToGoal:70+j%20,
   startTransition:j%4===0?"KICKOFF":"PUNT",
   endTransition:j%4===1?"PUNT":"SCORE",
   observedNextStartYardsToGoal:73,observedNextStartTransition:"PUNT",
   observedNextOffense:j%2?"home":"away",
  }:{})
 }));
 return {gameId:"historical"+i,homeTeamId:"TEAM_A",awayTeamId:"TEAM_B",
  kickoff:"2025-09-01T16:00:00Z",gradedAt:"2025-09-01T20:00:00Z",
  observedAt:"2025-09-02T03:00:00Z",source:"NFL_PBP_VERIFIED_POSSESSIONS",
  sourceFingerprint:"fingerprint-"+i,drives,
  regulationOnly:true,officialScoreMatched:true,homeScore:24,awayScore:21};
}
const base={gameId:"upcoming",snapshotId:"snapshot",frozenAt:"2026-10-23T17:00:00Z",
 kickoff:"2026-10-25T17:00:00Z",homeTeamId:"TEAM_A",awayTeamId:"TEAM_B",
 projectedHome:25,projectedAway:23,iterations:100};
test("NFL 0.3 challenger has repeatable source duration and next-field evidence",()=>{
 const games=Array.from({length:34},(_,i)=>historical(i));
 const a=simulateNflVerifiedDriveTransitionShadow({...base,trainingGames:games});
 const b=simulateNflVerifiedDriveTransitionShadow({...base,trainingGames:games});
 assert.equal(a.distributions.home_score.mean,b.distributions.home_score.mean);
 assert.equal(a.distributions.away_regulation_lead.mean,b.distributions.away_regulation_lead.mean);
 assert.equal(a.timeEvidence,"NFLFASTR_REPORTED_DRIVE_TIME_OF_POSSESSION");
 assert.equal(a.officialDurationDrives,680);
 assert.equal(a.linkedNextFieldDrives,680);
 assert.equal(a.canAuthorizeWager,false);
 assert.equal(a.canQualify,false);
 assert.equal(a.changesProductionChampion,false);
});
test("NFL 0.3 model refuses unverified official TOP and missing transitions",()=>{
 const games=Array.from({length:34},(_,i)=>historical(i,false));
 assert.throws(()=>simulateNflVerifiedDriveTransitionShadow({...base,trainingGames:games}),
  /NFL_TRANSITION_OFFICIAL_SOURCE_COVERAGE_INSUFFICIENT/);
 const e=Array.from({length:34},(_,i)=>historical(i));
 assert.throws(()=>simulateNflVerifiedDriveTransitionShadow({...base,trainingGames:e,
  frozenAt:"2026-10-26T00:00:00Z"}),/NFL_TRANSITION_INVALID_BASELINE/);
});

test("Observed field chain maps historical home/away roles to current offense correctly",()=>{
 assert.equal(mapHistoricalNextOffenseToTarget({offense:"away",observedNextOffense:"home"},"home"),"away");
 assert.equal(mapHistoricalNextOffenseToTarget({offense:"home",observedNextOffense:"home"},"away"),"away");
 assert.equal(mapHistoricalNextOffenseToTarget({offense:"home",observedNextOffense:null},"home"),null);
});
