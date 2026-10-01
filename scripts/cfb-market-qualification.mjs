#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";

fs.mkdirSync("artifacts",{recursive:true});
if(!fs.existsSync("artifacts/cfb-fbis-v2-design-rows.jsonl")){
  fs.copyFileSync("data/cfbd/calibration/design-rows.jsonl","artifacts/cfb-fbis-v2-design-rows.jsonl");
}
execFileSync(process.execPath,["scripts/cfb-v2-calibrate.mjs"],{
  stdio:"inherit",
  env:{...process.env,CFB_CALIBRATE_SKIP_FETCH:"1"}
});

const oos=JSON.parse(fs.readFileSync("artifacts/cfb-v2-oos-predictions.json","utf8"));
const select=JSON.parse(fs.readFileSync("data/cfbd/calibration/final-select-report.json","utf8"));
const ablation=select?.selection?.selected?.ablation || select?.selected?.ablation || select?.selection?.ablation || "A";
const rows=Array.isArray(oos?.[ablation])?oos[ablation]:[];
const priceWin=100/110;
const thresholds=[1,2,3,4,5,6,7];

function gradeSpread(r,threshold){
  if(r.closingSpread==null||!Number.isFinite(Number(r.closingSpread))) return null;
  const marketMargin=-Number(r.closingSpread);
  const edge=Number(r.predMargin)-marketMargin;
  if(Math.abs(edge)<threshold) return null;
  const side=edge>0?"HOME":"AWAY";
  const ats=Number(r.actualMargin)+Number(r.closingSpread);
  const result=Math.abs(ats)<1e-9?"PUSH":(ats>0?"HOME":"AWAY");
  return {side,result,win:result===side,loss:result!=="PUSH"&&result!==side,push:result==="PUSH",edge};
}
function gradeTotal(r,threshold){
  if(r.closingTotal==null||!Number.isFinite(Number(r.closingTotal))) return null;
  const edge=Number(r.predTotal)-Number(r.closingTotal);
  if(Math.abs(edge)<threshold) return null;
  const side=edge>0?"OVER":"UNDER";
  const diff=Number(r.actualTotal)-Number(r.closingTotal);
  const result=Math.abs(diff)<1e-9?"PUSH":(diff>0?"OVER":"UNDER");
  return {side,result,win:result===side,loss:result!=="PUSH"&&result!==side,push:result==="PUSH",edge};
}
function summarize(grades){
  const g=grades.filter(Boolean),wins=g.filter(x=>x.win).length,losses=g.filter(x=>x.loss).length,pushes=g.filter(x=>x.push).length;
  const decisions=wins+losses;
  const units=wins*priceWin-losses;
  return {n:g.length,decisions,wins,losses,pushes,hitRate:decisions?wins/decisions:null,units,roi:decisions?units/decisions:null,avgAbsEdge:g.length?g.reduce((s,x)=>s+Math.abs(x.edge),0)/g.length:null};
}
const spread={},total={};
for(const t of thresholds){
  spread[t]=summarize(rows.map(r=>gradeSpread(r,t)));
  total[t]=summarize(rows.map(r=>gradeTotal(r,t)));
}
const report={
  generatedAt:new Date().toISOString(),
  modelId:"CFB-FBIS-v2",
  selectedAblation:ablation,
  sampleN:rows.length,
  pricingAssumption:"-110 flat for historical threshold screening; not a substitute for executable-book pricing",
  spread,
  total,
  governance:{
    autoPromote:false,
    canQualify:false,
    rule:"Historical market-relative evidence must be positive and stable before an operator-approved qualification change."
  }
};
fs.writeFileSync("artifacts/cfb-market-qualification-report.json",JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
