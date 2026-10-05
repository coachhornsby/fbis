#!/usr/bin/env node
import fs from "node:fs";

const legacyPath=process.argv[2]||"artifacts/legacy-market/soccer-market-benchmark-rows.jsonl";
const v2Path=process.argv[3]||"artifacts/v2-walkforward/soccer-v2-walkforward-rows.jsonl";

const read=p=>fs.readFileSync(p,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const legacy=read(legacyPath), v2=read(v2Path);
const key=r=>`${r.league}:${r.id}`;
const v2By=new Map(v2.map(r=>[key(r),r]));
const joined=[];
for(const old of legacy){
  const cur=v2By.get(key(old));
  if(!cur) continue;
  const market={H:Number(old.marketHome),D:Number(old.marketDraw),A:Number(old.marketAway)};
  const model={H:Number(cur.v2Home),D:Number(cur.v2Draw),A:Number(cur.v2Away)};
  const outcome=String(cur.outcome||old.outcome||"");
  if(!["H","D","A"].includes(outcome)) continue;
  if(Object.values(market).some(x=>!Number.isFinite(x))||Object.values(model).some(x=>!Number.isFinite(x))) continue;
  joined.push({...cur,
    marketHome:market.H,marketDraw:market.D,marketAway:market.A,
    modelBrier:brier(model,outcome),marketBrier:brier(market,outcome),
    modelLogLoss:-Math.log(Math.max(1e-12,model[outcome])),
    marketLogLoss:-Math.log(Math.max(1e-12,market[outcome])),
    modelCorrect:argmax(model)===outcome,marketCorrect:argmax(market)===outcome,
  });
}
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const report={
  generatedAt:new Date().toISOString(),
  modelId:"SOCCER-FBIS-v2",
  benchmark:"REPLAY_EXISTING_ZEN_ACTION_NO_VIG_1X2",
  sourceSample:"soccer-market-benchmark-37186030331",
  oldMatched:legacy.length,
  matched:joined.length,
  costUsd:0,
  model:{
    brier:mean(joined.map(x=>x.modelBrier)),
    logLoss:mean(joined.map(x=>x.modelLogLoss)),
    accuracy:joined.length?joined.filter(x=>x.modelCorrect).length/joined.length:null,
  },
  market:{
    brier:mean(joined.map(x=>x.marketBrier)),
    logLoss:mean(joined.map(x=>x.marketLogLoss)),
    accuracy:joined.length?joined.filter(x=>x.marketCorrect).length/joined.length:null,
  },
};
report.deltas={
  brier:report.model.brier-report.market.brier,
  logLoss:report.model.logLoss-report.market.logLoss,
  accuracy:report.model.accuracy-report.market.accuracy,
};
report.promotion={
  samplePass:joined.length>=150,
  beatsMarketBrier:report.model.brier<report.market.brier,
  beatsMarketLogLoss:report.model.logLoss<report.market.logLoss,
  decision:joined.length>=150&&report.model.brier<report.market.brier&&report.model.logLoss<report.market.logLoss
    ?"MARKET_BENCHMARK_PASS":"RESEARCH",
  canQualify:false,
  canAuthorize:false,
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/soccer-v2-market-replay.json",JSON.stringify(report,null,2));
fs.writeFileSync("artifacts/soccer-v2-market-replay-rows.jsonl",joined.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
if(joined.length<150) process.exitCode=3;

function argmax(p){return ["H","D","A"].sort((a,b)=>p[b]-p[a])[0];}
function brier(p,o){return(["H","D","A"].reduce((s,k)=>s+(p[k]-(k===o?1:0))**2,0))/3;}
