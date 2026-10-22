import test from "node:test";
import assert from "node:assert/strict";
import {summarizeCfbDriveCohort,cfbDriveCohortReport} from "../functions/lib/cfbDriveCohortReport.js";
import {onRequestGet} from "../functions/api/cfb-simulation.js";
const r={
 game_id:"401856727",kickoff:"2026-10-24T19:30Z",
 frozen_at:"2026-10-22T15:04:22Z",
 training_games:60,training_drives:1347,iterations:1000,
 home_name:"Alabama",away_name:"Texas A&M",
 baseline_json:JSON.stringify({home:31.7,away:23.1,sourceFrozenAt:"2026-10-22T06:58:16Z"}),
 distributions_json:JSON.stringify({
  home_score:{mean:26.2},away_score:{mean:24.1},
  total:{mean:50.3,p10:30,p90:70},
  margin:{mean:2.1,p10:-17,p90:24}}),
};
test("Unsettled research never claims a calibrated winner or wagering permissions",()=>{
 const s=summarizeCfbDriveCohort([r]);
 assert.equal(s.frozen,1);assert.equal(s.graded,0);
 assert.equal(s.scores.v2TotalMAE,null);
 assert.equal(s.calibrationStatus,"INSUFFICIENT_PROSPECTIVE_GRADES");
 assert.equal(s.canAuthorizeWager,false);
 assert.equal(s.games[0].sourceSnapshotFrozenAt,"2026-10-22T06:58:16Z");
 assert.equal(s.games[0].v2.total,50.3);
});
test("Grade summary compares frozen original against drive V2 with actual verified scores",()=>{
 const s=summarizeCfbDriveCohort([{...r,grade_run_id:"run-1",score_home:24,score_away:21,
  total_80_covered:1,margin_80_covered:1,total_90_covered:1,margin_90_covered:1}]);
 assert.equal(s.graded,1);
 assert.equal(s.scores.originalTotalMAE,9.8);
 assert.equal(s.scores.v2TotalMAE,5.3);
 assert.equal(s.scores.originalMarginMAE,5.6);
 assert.equal(s.scores.v2MarginMAE,0.9);
 assert.equal(s.intervalCoverage.total80,1);
 assert.equal(s.calibrationStatus,"INSUFFICIENT_PROSPECTIVE_GRADES");
});
test("Report uses CFB_DB only and fails closed",async()=>{
 await assert.rejects(cfbDriveCohortReport({DB:{prepare(){throw Error("PRIMARY_WRONG")}}}),/CFB_DB_UNBOUND/);
 const env={CFB_DB:{prepare(sql){if(!sql.includes("cfb_drive_shadow_runs"))throw Error("unexpected table");return{bind(){return{all:async()=>({results:[r]})}}}}}};
 const s=await cfbDriveCohortReport(env);
 assert.equal(s.frozen,1);
 assert.equal(s.scope,"CFB_DB");
});
test("Cohort endpoint requires operator header authentication",async()=>{
 const env={HARVEST_SECRET:"test-operator",CFB_DB:{prepare(){throw Error("SHOULD_NOT_READ")}}};
 const request=new Request("https://fbis.test/api/cfb-simulation?mode=cohort");
 assert.equal((await onRequestGet({request,env})).status,401);
});
