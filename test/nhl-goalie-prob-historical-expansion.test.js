import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCKED_GOALIE_SCALE,
  historicalShadowPrediction,
  predictiveMetrics,
  pairedSummary,
  calibrationFit,
  requiredSampleForMeanEffect
} from "../functions/lib/nhlGoalieHistoricalExpansion.js";

test("historical NHL goalie expansion locks production 0.25 shrink and preserves score",()=>{
  assert.equal(LOCKED_GOALIE_SCALE,0.25);
  const row={
    projHome:3.2,projAway:2.8,homeWinProb:0.57,
    goalieVsHome:0.12,goalieVsAway:-0.08,eloDiff:25
  };
  const p=historicalShadowPrediction(row);
  assert.equal(p.ok,true);
  assert.equal(p.projHome,3.2);
  assert.equal(p.projAway,2.8);
  assert.equal(p.scoreProjectionChanged,false);
  assert.equal(Number.isFinite(p.shadowP),true);
});

test("historical expansion metrics are paired and finite",()=>{
  const rows=[
    {projHome:3,projAway:2,actualHomeGoals:4,actualAwayGoals:2,incumbentP:0.60,shadowP:0.58},
    {projHome:2.5,projAway:3,actualHomeGoals:1,actualAwayGoals:3,incumbentP:0.45,shadowP:0.43},
    {projHome:3.1,projAway:3,actualHomeGoals:2,actualAwayGoals:3,incumbentP:0.53,shadowP:0.51},
    {projHome:2.7,projAway:2.4,actualHomeGoals:3,actualAwayGoals:2,incumbentP:0.55,shadowP:0.54}
  ];
  const m=predictiveMetrics(rows,"shadowP");
  assert.equal(m.n,4);
  assert.equal(Number.isFinite(m.brier),true);
  const p=pairedSummary(rows);
  assert.equal(Number.isFinite(p.brier.mean),true);
  assert.equal(calibrationFit(rows,"shadowP").n,4);
  assert.equal(requiredSampleForMeanEffect([0.01,0.00,0.02,-0.005])>0,true);
});

test("missing locked PIT inputs fail closed",()=>{
  const p=historicalShadowPrediction({projHome:3,projAway:2,homeWinProb:0.6,goalieVsHome:null,goalieVsAway:0.1,eloDiff:10});
  assert.equal(p.ok,false);
  assert.equal(p.reason,"REQUIRED_PIT_INPUT_MISSING");
});
