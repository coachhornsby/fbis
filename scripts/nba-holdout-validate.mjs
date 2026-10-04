#!/usr/bin/env node
import fs from "node:fs";
import { applyNbaCalibration, NBA_CALIBRATION } from "../functions/lib/nbaModel.js";

const gameFile=process.argv[2]||"artifacts/nba-fbis-v1-rows.jsonl";
const propFile=process.argv[3]||"artifacts/nba-player-prop-rows.jsonl";
const snapshotFile=process.argv[4]||"research/nba/frozen-snapshot.json";
const out=process.argv[5]||"artifacts/nba-holdout-validation.json";

const readJsonl=p=>fs.readFileSync(p,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const rmse=xs=>xs.length?Math.sqrt(mean(xs.map(x=>x*x))):null;
const gameRows=readJsonl(gameFile);
const propRows=readJsonl(propFile);
const snap=JSON.parse(fs.readFileSync(snapshotFile,"utf8"));
const HOLDOUT_START="2025-10-21";
const gameHold=gameRows.filter(r=>String(r.date)>=HOLDOUT_START);
const propHold=propRows.filter(r=>String(r.date)>=HOLDOUT_START);

function gameMetrics(rows,kind="calibrated"){
  const valid=rows.filter(r=>Number.isFinite(Number(r.modelMargin))&&Number.isFinite(Number(r.modelTotal)));
  const projections=valid.map(r=>{
    if(kind==="benchmark")return {margin:Number(r.formMargin),total:Number(r.formTotal)};
    if(kind==="raw")return {margin:Number(r.modelMargin),total:Number(r.modelTotal)};
    return applyNbaCalibration(Number(r.modelMargin),Number(r.modelTotal));
  });
  const paired=valid.map((r,i)=>({...r,pm:projections[i].margin,pt:projections[i].total}))
    .filter(r=>Number.isFinite(r.pm)&&Number.isFinite(r.pt));
  const me=paired.map(r=>r.pm-Number(r.actualMargin));
  const te=paired.map(r=>r.pt-Number(r.actualTotal));
  return {
    n:paired.length,
    marginMae:mean(me.map(Math.abs)), totalMae:mean(te.map(Math.abs)),
    marginRmse:rmse(me), totalRmse:rmse(te),
    marginBias:mean(me), totalBias:mean(te),
    winnerAccuracy:paired.length?paired.filter(r=>(r.pm>0)===(Number(r.actualMargin)>0)).length/paired.length:null
  };
}
function propMetrics(rows){
  const out={};
  for(const market of [...new Set(rows.map(r=>r.market))].sort()){
    const xs=rows.filter(r=>r.market===market&&Number.isFinite(Number(r.error)));
    const es=xs.map(r=>Number(r.error));
    const bs=xs.filter(r=>Number.isFinite(Number(r.baselineError))).map(r=>Number(r.baselineError));
    out[market]={
      n:xs.length,mae:mean(es.map(Math.abs)),rmse:rmse(es),bias:mean(es),
      baselineN:bs.length,trailing10BaselineMae:mean(bs.map(Math.abs)),
      maeAdvantageVsTrailing10:mean(bs.map(Math.abs))-mean(es.map(Math.abs))
    };
  }
  return out;
}
const raw=gameMetrics(gameHold,"raw");
const model=gameMetrics(gameHold,"calibrated");
const benchmark=gameMetrics(gameHold,"benchmark");
const report={
  generatedAt:new Date().toISOString(),
  snapshotId:snap.snapshotId,
  snapshotArtifactId:snap.github.artifactId,
  snapshotSha256:snap.github.artifactSha256,
  design:{trainingWindow:"2024-10-22 through 2025-06-22",untouchedHoldoutStart:HOLDOUT_START,randomSplit:false},
  game:{
    modelId:"NBA-FBIS-v1",modelVersion:"research-v1.1-calibrated",benchmark:"NBA-FBIS-FORM-v1",
    calibration:NBA_CALIBRATION,rawHoldout:raw,holdout:model,benchmarkHoldout:benchmark,
    deltas:{marginMae:model.marginMae-benchmark.marginMae,totalMae:model.totalMae-benchmark.totalMae,winnerAccuracy:model.winnerAccuracy-benchmark.winnerAccuracy}
  },
  props:{
    modelId:"NBA-PLAYER-PROP-v1",holdout:propMetrics(propHold),
    integrity:{
      actualTeamScoreUsedAsFeature:false,actualPossessionsUsedAsFeature:false,
      propLinesUsedAsFeatures:false,targetGameStatsUsedAsFeatures:false,
      historicalAvailabilityReconstructed:false,
      evaluationCondition:"target player appeared in target-game box score"
    },
    marketLineValidation:"NOT_AVAILABLE_IN_FROZEN_SNAPSHOT"
  },
  governance:{
    maturity:"VALIDATION",canQualify:false,canAuthorize:false,
    gameProspectiveShadowEligible:model.marginMae<benchmark.marginMae&&model.totalMae<benchmark.totalMae&&model.winnerAccuracy>benchmark.winnerAccuracy,
    propProspectiveShadowOnly:true,
    marketCloseValidationRequired:true,propMarketValidationRequired:true
  }
};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
