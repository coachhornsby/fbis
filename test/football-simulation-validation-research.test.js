import test from "node:test";
import assert from "node:assert/strict";
import {gradeRegulationSimulations,fitNflDriveOutcomeResearch} from "../functions/lib/footballSimulationValidationResearch.js";
const asOf="2026-10-23T12:00:00Z";
const row={sport:"nfl",regulationOnly:true,gameId:"g1",kickoff:"2026-10-20T18:00:00Z",
 frozenAt:"2026-10-19T18:00:00Z",gradedAt:"2026-10-21T01:00:00Z",
 observedAt:"2026-10-20T22:00:00Z",homeScore:28,awayScore:14,
 projectedHome:24,projectedAway:17,homeWinProb:.75,awayWinProb:.2,tieProb:.05,
 homeBlowoutProb:.3,awayBlowoutProb:.1,prospectiveReceiptId:"receipt-1",
 modelVersion:"test-shadow",sourceFingerprint:"sha256:test"};
test("Football grading excludes postgame and nonprospective data",()=>{
 const sample=gradeRegulationSimulations([row,{...row,gameId:"bad",frozenAt:"2026-10-21T00:00:00Z"}],{sport:"nfl",asOf,minSample:1});
 assert.equal(sample.n,1);
 assert.equal(sample.exclusions.TEMPORAL_VIOLATION,1);
 assert.ok(sample.metrics.brierScore>0);
 assert.equal(sample.metrics.marginMAE,7);
 assert.equal(sample.metrics.totalMAE,1);
 assert.equal(sample.canAuthorizeWager,false);
 assert.equal(sample.calibrated,false);
});
test("Missing data never creates finished calibration statistics",()=>{
 const grade=gradeRegulationSimulations([{...row,prospectiveReceiptId:null}],{sport:"nfl",asOf,minSample:1});
 assert.equal(grade.n,0);assert.equal(grade.metrics,null);
 assert.equal(grade.exclusions.MISSING_PROVENANCE,1);
});
test("NFL descriptive drive rates require timestamped sufficient history",()=>{
 const ds=Array.from({length:600},(_,i)=>({
 gameId:"game"+Math.floor(i/20),teamId:"team"+(i%2),
 kickoff:"2026-10-01T00:00:00Z",observedAt:"2026-10-02T00:00:00Z",
 startYardsToGoal:75,outcome:["TD","FG","EMPTY"][i%3]}));
 let a=fitNflDriveOutcomeResearch(ds,{asOf});
 assert.equal(a.n,600);assert.equal(a.frequencies.TD,1/3);
 assert.equal(a.calibrated,false);
 a=fitNflDriveOutcomeResearch(ds.map(d=>({...d,observedAt:"2026-10-25T00:00:00Z"})),{asOf});
 assert.equal(a.frequencies,null);
});

test("Actual grade lifecycle: source observed after kickoff, grade written after observation",()=>{
 const good={...row,gameId:"live-game",frozenAt:"2026-10-19T18:00:00Z",
  kickoff:"2026-10-20T18:00:00Z",observedAt:"2026-10-20T22:00:00Z",
  gradedAt:"2026-10-21T01:00:00Z",prospectiveReceiptId:"sha:live"};
 const result=gradeRegulationSimulations([good],{sport:"nfl",asOf,minSample:1});
 assert.equal(result.n,1);
 assert.equal(result.exclusions.TEMPORAL_VIOLATION,undefined);
 assert.equal(result.metrics.marginMAE,7);
 assert.equal(result.canAuthorizeWager,false);
 for(const bad of [
  {...good,observedAt:"2026-10-20T17:00:00Z"},
  {...good,gradedAt:"2026-10-20T21:00:00Z"},
  {...good,gradedAt:"2026-10-25T12:00:00Z"}
 ]){
  const tested=gradeRegulationSimulations([bad],{sport:"nfl",asOf,minSample:1});
  assert.equal(tested.n,0);
  assert.equal(tested.exclusions.TEMPORAL_VIOLATION,1);
 }
});
