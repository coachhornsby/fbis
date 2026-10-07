import test from "node:test";
import assert from "node:assert/strict";
import { aggregateEconomicCohort, economicGradeSetId, CALIBRATION_VERSION, DRAWDOWN_VERSION } from "../functions/lib/canonical/economicCohorts.js";

test("cohort economics preserves absent probability metrics as null",()=>{
  const out=aggregateEconomicCohort([
    {grade_id:"a",graded_at:"2026-10-07T01:00:00Z",stake_units:1,profit_units:1,result:"WIN",projected_probability:null,brier:null,log_loss:null,clv_probability:null},
    {grade_id:"b",graded_at:"2026-10-07T02:00:00Z",stake_units:1,profit_units:-1,result:"LOSS",projected_probability:null,brier:null,log_loss:null,clv_probability:null},
  ]);
  assert.equal(out.observationsN,2); assert.equal(out.profitUnits,0); assert.equal(out.roi,0);
  assert.equal(out.brierMean,null); assert.equal(out.logLossMean,null); assert.equal(out.clvProbabilityMean,null);
  assert.equal(out.calibrationValue,null); assert.equal(out.calibrationMethodVersion,null);
  assert.equal(out.maxDrawdownUnits,1); assert.equal(out.drawdownMethodVersion,DRAWDOWN_VERSION);
});

test("cohort calibration is explicit ten-bin ECE and drawdown follows graded order",()=>{
  const out=aggregateEconomicCohort([
    {grade_id:"c",graded_at:"2026-10-07T03:00:00Z",stake_units:1,profit_units:2,result:"WIN",projected_probability:.8,brier:.04,log_loss:.2,clv_probability:.03},
    {grade_id:"a",graded_at:"2026-10-07T01:00:00Z",stake_units:1,profit_units:1,result:"WIN",projected_probability:.6,brier:.16,log_loss:.5,clv_probability:.01},
    {grade_id:"b",graded_at:"2026-10-07T02:00:00Z",stake_units:1,profit_units:-1,result:"LOSS",projected_probability:.4,brier:.16,log_loss:.5,clv_probability:.02},
  ]);
  assert.equal(out.observationsN,3); assert.equal(out.profitUnits,2); assert.ok(Math.abs(out.roi-2/3)<1e-12);
  assert.ok(Math.abs(out.brierMean-.12)<1e-12); assert.ok(Math.abs(out.clvProbabilityMean-.02)<1e-12);
  assert.ok(Math.abs(out.calibrationValue-(.4+.4+.2)/3)<1e-12); assert.equal(out.calibrationMethodVersion,CALIBRATION_VERSION);
  assert.equal(out.maxDrawdownUnits,1);
});

test("cohort identity advances only when the immutable grade set changes",async()=>{
  const a=await economicGradeSetId([{grade_id:"b"},{grade_id:"a"}]);
  const replay=await economicGradeSetId([{grade_id:"a"},{grade_id:"b"}]);
  const grown=await economicGradeSetId([{grade_id:"a"},{grade_id:"b"},{grade_id:"c"}]);
  assert.equal(a,replay);
  assert.notEqual(a,grown);
});

test("drawdown stays null when any cohort profit is absent",()=>{
  const out=aggregateEconomicCohort([
    {grade_id:"a",graded_at:"2026-10-07T01:00:00Z",stake_units:1,profit_units:1,result:"WIN"},
    {grade_id:"b",graded_at:"2026-10-07T02:00:00Z",stake_units:1,profit_units:null,result:"LOSS"},
  ]);
  assert.equal(out.profitUnits,null);
  assert.equal(out.roi,null);
  assert.equal(out.maxDrawdownUnits,null);
  assert.equal(out.drawdownMethodVersion,null);
});
