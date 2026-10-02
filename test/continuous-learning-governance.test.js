import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTINUOUS_LEARNING_POLICY,
  probabilityMetrics,
  buildMonitoringArtifact,
  buildRecalibrationAndGate,
  bayesianBiasState,
  shadowModelWeights,
} from "../functions/lib/continuousLearning.js";

function rows(n,{p=0.62,bias=0,modelId="NFL-TEST"}={}){
  return Array.from({length:n},(_,i)=>{
    const homeWin = i % 5 !== 0;
    const actualHome = homeWin ? 27 : 20;
    const actualAway = homeWin ? 20 : 24;
    return {
      sport:"nfl",
      gameId:`g-${i}`,
      learningModelId:modelId,
      engine:modelId,
      modelVersion:"v1",
      frozenAt:new Date(Date.UTC(2026,0,1+i)).toISOString(),
      start:new Date(Date.UTC(2026,0,1+i,4)).toISOString(),
      projHome:actualHome+bias,
      projAway:actualAway,
      projMargin:(actualHome-actualAway)+bias,
      projTotal:(actualHome+actualAway)+bias,
      pHomeFinal:homeWin ? p : 1-p,
      actualHome,
      actualAway,
    };
  });
}

test("tier 1 reports calibration and score metrics without mutating models",()=>{
  const a=buildMonitoringArtifact(rows(120),{sport:"nfl",modelId:"NFL-TEST",recentN:40});
  assert.equal(a.tier,1);
  assert.equal(a.observedN,120);
  assert.equal(a.recentN,40);
  assert.ok(Number.isFinite(a.metrics.probability.brier));
  assert.ok(Number.isFinite(a.metrics.score.margin.mae));
  assert.ok(Array.isArray(a.alerts));
});

test("tier 2 is sample-count gated and produces a separate calibration holdout",()=>{
  const small=buildRecalibrationAndGate(rows(CONTINUOUS_LEARNING_POLICY.minRecalibrationN-1),{sport:"nfl",modelId:"NFL-TEST"});
  assert.equal(small.status,"INSUFFICIENT_DATA");

  const fit=buildRecalibrationAndGate(rows(220,{p:0.56}),{sport:"nfl",modelId:"NFL-TEST"});
  assert.equal(fit.status,"FIT");
  assert.ok(fit.trainN>0);
  assert.ok(fit.holdoutN>=CONTINUOUS_LEARNING_POLICY.minChallengerHoldoutN);
  assert.ok(["platt","beta"].includes(fit.method));
  assert.equal(fit.tier3.gate.manualPromotionRequired,true);
  assert.equal(fit.tier3.gate.autoPromote,false);
  assert.ok(Array.isArray(fit.tier3.bootstrap.brier.ci95));
});

test("tier 4 uses shrinkage and remains advisory",()=>{
  const a=bayesianBiasState(rows(100,{bias:2}),{sport:"nfl",modelId:"NFL-TEST"});
  assert.equal(a.tier,4);
  const margin=a.states.find(x=>x.target==="margin_bias");
  assert.equal(margin.status,"UPDATED");
  assert.equal(margin.advisoryOnly,true);
  assert.ok(Math.abs(margin.posteriorMean)<2);
  assert.ok(margin.recommendedCorrection<0);
});

test("tier 5 is hard-coded shadow-only",()=>{
  const groups=new Map([
    ["A",rows(80,{p:0.60,modelId:"A"})],
    ["B",rows(80,{p:0.70,modelId:"B"})],
  ]);
  const out=shadowModelWeights(groups,{sport:"nfl"});
  assert.equal(out.tier,5);
  assert.equal(out.status,"SHADOW_ONLY");
  assert.equal(out.productionEnabled,false);
  assert.equal(out.wagerAuthority,false);
  assert.equal(out.weights.length,2);
  const sum=out.weights.reduce((s,x)=>s+x.weight,0);
  assert.ok(Math.abs(sum-1)<1e-9);
});

test("probability metrics include Brier, log loss and calibration error",()=>{
  const m=probabilityMetrics(rows(60,{p:0.65}));
  assert.equal(m.n,60);
  assert.ok(m.brier>=0);
  assert.ok(m.logLoss>=0);
  assert.ok(m.ece>=0);
  assert.ok(m.bins.length>0);
});
