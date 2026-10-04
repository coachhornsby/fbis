#!/usr/bin/env node
import fs from "node:fs";

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

const TRAIN_END="2025-06-30";
const HOLDOUT_START="2025-10-21";
const gameHold=gameRows.filter(r=>String(r.date)>=HOLDOUT_START);
const propHold=propRows.filter(r=>String(r.date)>=HOLDOUT_START);

function gameMetrics(rows,prefix="model"){
  const marginKey=prefix==="model"?"modelMargin":"formMargin";
  const totalKey=prefix==="model"?"modelTotal":"formTotal";
  const valid=rows.filter(r=>Number.isFinite(Number(r[marginKey]))&&Number.isFinite(Number(r[totalKey])));
  const marginErr=valid.map(r=>Number(r[marginKey])-Number(r.actualMargin));
  const totalErr=valid.map(r=>Number(r[totalKey])-Number(r.actualTotal));
  return {
    n:valid.length,
    marginMae:mean(marginErr.map(Math.abs)),
    totalMae:mean(totalErr.map(Math.abs)),
    marginRmse:rmse(marginErr),
    totalRmse:rmse(totalErr),
    marginBias:mean(marginErr),
    totalBias:mean(totalErr),
    winnerAccuracy:valid.length?valid.filter(r=>(Number(r[marginKey])>0)===(Number(r.actualMargin)>0)).length/valid.length:null
  };
}
function propMetrics(rows){
  const out={};
  for(const market of [...new Set(rows.map(r=>r.market))].sort()){
    const xs=rows.filter(r=>r.market===market&&Number.isFinite(Number(r.error)));
    const es=xs.map(r=>Number(r.error));
    out[market]={n:xs.length,mae:mean(es.map(Math.abs)),rmse:rmse(es),bias:mean(es)};
  }
  return out;
}
const model=gameMetrics(gameHold,"model");
const benchmark=gameMetrics(gameHold,"form");
const report={
  generatedAt:new Date().toISOString(),
  snapshotId:snap.snapshotId,
  snapshotArtifactId:snap.github.artifactId,
  snapshotSha256:snap.github.artifactSha256,
  design:{trainingWindow:"2024-10-22 through 2025-06-30",untouchedHoldoutStart:HOLDOUT_START,randomSplit:false},
  game:{modelId:"NBA-FBIS-v1",benchmark:"NBA-FBIS-FORM-v1",holdout:model,benchmarkHoldout:benchmark,
    deltas:{marginMae:model.marginMae-benchmark.marginMae,totalMae:model.totalMae-benchmark.totalMae,winnerAccuracy:model.winnerAccuracy-benchmark.winnerAccuracy}},
  props:{modelId:"NBA-PLAYER-PROP-v1",holdout:propMetrics(propHold),marketLineValidation:"NOT_AVAILABLE_IN_FROZEN_SNAPSHOT"},
  governance:{maturity:"VALIDATION",canQualify:false,canAuthorize:false,marketCloseValidationRequired:true,propMarketValidationRequired:true}
};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
