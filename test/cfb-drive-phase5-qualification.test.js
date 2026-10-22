import test from "node:test";
import assert from "node:assert/strict";
import {
 evaluateCfbDrivePhase5,cfbDrivePhase5Audit,
} from "../functions/lib/cfbDrivePhase5Qualification.js";
import {onRequestGet} from "../functions/api/cfb-simulation.js";

const auditNow="2026-10-30T18:00:00.000Z";
function makeRow(i,{graded=true,missingSource=false,date=null,afterKickoff=false}={}){
 const d=date||(i%2?"2026-10-24":"2026-10-25");
 const kickoff=d+"T15:00:00.000Z";
 const baseline={home:30,away:24,sourceFrozenAt:"2026-10-20T15:00:00Z"};
 const distributions={
   home_score:{mean:27},away_score:{mean:24},total:{mean:51,
      p05:24,p10:30,p25:42,p50:50,p75:60,p90:72,p95:78},
   margin:{mean:3,p05:-21,p10:-15,p25:-7,p50:3,p75:11,p90:18,p95:25},
 };
 return {
   id:"run"+i,game_id:"game"+i,
   kickoff,frozen_at:afterKickoff?d+"T16:00:00.000Z":d+"T11:00:00.000Z",
   authority:"RESEARCH_SHADOW_ONLY",can_authorize_wager:0,
   baseline_json:JSON.stringify(baseline),
   distributions_json:JSON.stringify(distributions),
   grade_run_id:graded?"grade"+i:null,
   grade_fingerprint:graded?"hash"+i:null,
   source_fingerprint:missingSource?"mismatch":"hash"+i,
   source_verified:missingSource?0:1,source_period:"REGULATION_ONLY",
   source_observed_at:d+"T21:00:00.000Z",
   actual_home:graded?27:null,actual_away:graded?24:null,
   evidence_fingerprint:"train-hash",
 };
}
test("No completed games: null MAEs, no false calibrated probabilities",()=>{
 const a=evaluateCfbDrivePhase5([makeRow(1,{graded:false}),makeRow(2,{graded:false})],
   {now:"2026-10-22T18:00:00Z"});
 assert.equal(a.sample.frozen,2);
 assert.equal(a.sample.verifiedGrades,0);
 assert.equal(a.sample.notYetStarted,2);
 assert.equal(a.pairedError.originalTotalMAE,null);
 assert.equal(a.pairedError.totalImprovement,null);
 assert.equal(a.conclusion,"NOT_EVALUABLE_PENDING_VERIFIED_OUTCOMES");
 assert.equal(a.canAuthorizeWager,false);
});
test("Thirty independent final games create paired bootstrap and Wilson intervals",()=>{
 const rows=Array.from({length:30},(_,i)=>makeRow(i));
 const a=evaluateCfbDrivePhase5(rows,{now:auditNow});
 assert.equal(a.sample.frozen,30);
 assert.equal(a.sample.verifiedGrades,30);
 assert.equal(a.sample.gradeDates.length,2);
 assert.equal(a.qualificationGates.atLeast30DistinctGraded,true);
 assert.equal(a.researchEvaluable,true);
 assert.equal(a.pairedError.originalTotalMAE,3);
 assert.equal(a.pairedError.v2TotalMAE,0);
 assert.equal(a.pairedError.originalMarginMAE,3);
 assert.equal(a.pairedError.v2MarginMAE,0);
 assert.equal(a.pairedError.totalImprovement.ci95Low,3);
 assert.equal(a.pairedError.marginImprovement.ci95High,3);
 assert.equal(a.intervalCalibration.total80.rate,1);
 assert.equal(a.noAutomaticPromotion,true);
 assert.equal(a.canAuthorizeWager,false);
});
test("Duplicate research runs must not double count independent games",()=>{
 const first=makeRow(0),second={...makeRow(0),id:"later",frozen_at:"2026-10-25T12:00:00.000Z"};
 const a=evaluateCfbDrivePhase5([second,first],{now:auditNow});
 assert.equal(a.sample.frozen,1);
 assert.equal(a.sample.duplicateRunRows,1);
 assert.equal(a.sample.verifiedGrades,1);
});
test("Source-fingerprint mismatch and post-kickoff freezes do not qualify",()=>{
 const invalid=makeRow(2,{afterKickoff:true});
 const mismatch=makeRow(1,{missingSource:true});
 const a=evaluateCfbDrivePhase5([invalid,mismatch],{now:auditNow});
 assert.equal(a.sample.invalidFrozenRows,1);
 assert.equal(a.sample.invalidGradeRows,1);
 assert.equal(a.sample.verifiedGrades,0);
 assert.equal(a.researchEvaluable,false);
});
test("Missing verified grades count against aged capture, not as model errors",()=>{
 const rows=Array.from({length:40},(_,i)=>makeRow(i,{graded:i<30}));
 const a=evaluateCfbDrivePhase5(rows,{now:auditNow});
 assert.equal(a.sample.verifiedGrades,30);
 assert.equal(a.sample.overdueForSource,40);
 assert.equal(a.sample.overdueWithVerifiedGrades,30);
 assert.equal(a.sample.agedResultCapture.rate,.75);
 assert.equal(a.researchEvaluable,true);
});
test("Only 1 slate or 29 grades cannot produce research evaluable",()=>{
 const rows=Array.from({length:30},(_,i)=>makeRow(i,{date:"2026-10-24"}));
 const a=evaluateCfbDrivePhase5(rows,{now:auditNow});
 assert.equal(a.qualificationGates.atLeast2KickoffDates,false);
 assert.equal(a.researchEvaluable,false);
 const b=evaluateCfbDrivePhase5(rows.slice(0,29),{now:auditNow});
 assert.equal(b.researchEvaluable,false);
 assert.equal(b.pairedError.marginImprovement,null);
});
test("Phase5 never consults primary DB nor accepts unauthenticated requests",async()=>{
 await assert.rejects(cfbDrivePhase5Audit({DB:{prepare(){throw Error("PRIMARY_UNSAFE")}}}),/CFB_DB_UNBOUND/);
 const env={HARVEST_SECRET:"test-key",CFB_DB:{prepare(){throw Error("CANNOT_TOUCH_DB")}}};
 const request=new Request("https://example.com/api/cfb-simulation?mode=qualification");
 assert.equal((await onRequestGet({request,env})).status,401);
});
test("Phase5 read cap fail-closed; no misleading partial research qualification",async()=>{
 const db={prepare(sql){assert.match(sql,/cfb_drive_shadow_runs/);return{
   all:async()=>({results:Array.from({length:501},(_,i)=>makeRow(i))}),
 };}};
 await assert.rejects(cfbDrivePhase5Audit({CFB_DB:db}),/CFB_QUALIFICATION_ROW_CAP_REACHED/);
});
