#!/usr/bin/env node
import fs from "node:fs";
const legacy=read(process.argv[2]||"artifacts/legacy-market/soccer-market-benchmark-rows.jsonl");
const v3=read(process.argv[3]||"artifacts/v3/soccer-v3-walkforward-rows.jsonl");
function read(p){return fs.readFileSync(p,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);}
function norm(s){return String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/\b(fc|cf|sc|afc|club|de|futbol|football|soccer)\b/g," ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");}
function date(x){return String(x?.date||x?.start||"").slice(0,10);}
function key(x){return [x.league,date(x),norm(x.homeTeam),norm(x.awayTeam)].join("|");}
const by=new Map(v3.map(x=>[key(x),x])),rows=[];
for(const old of legacy){
  const cur=by.get(key(old));if(!cur)continue;
  const market={H:Number(old.marketHome),D:Number(old.marketDraw),A:Number(old.marketAway)};
  const model={H:Number(cur.v3Home??cur.pHome),D:Number(cur.v3Draw??cur.pDraw),A:Number(cur.v3Away??cur.pAway)};
  const outcome=String(cur.outcome||old.outcome||"");
  if(!["H","D","A"].includes(outcome)||Object.values(market).some(x=>!Number.isFinite(x))||Object.values(model).some(x=>!Number.isFinite(x)))continue;
  rows.push({...cur,marketHome:market.H,marketDraw:market.D,marketAway:market.A,
    modelBrier:brier(model,outcome),marketBrier:brier(market,outcome),
    modelLogLoss:-Math.log(Math.max(1e-12,model[outcome])),marketLogLoss:-Math.log(Math.max(1e-12,market[outcome])),
    modelCorrect:argmax(model)===outcome,marketCorrect:argmax(market)===outcome});
}
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const report={generatedAt:new Date().toISOString(),modelId:"SOCCER-FBIS-v3",benchmark:"REPLAY_EXISTING_ZEN_ACTION_NO_VIG_1X2",sourceSample:"soccer-market-benchmark-37186030331",oldMatched:legacy.length,matched:rows.length,costUsd:0,
  model:{brier:mean(rows.map(x=>x.modelBrier)),logLoss:mean(rows.map(x=>x.modelLogLoss)),accuracy:rows.length?mean(rows.map(x=>x.modelCorrect?1:0)):null},
  market:{brier:mean(rows.map(x=>x.marketBrier)),logLoss:mean(rows.map(x=>x.marketLogLoss)),accuracy:rows.length?mean(rows.map(x=>x.marketCorrect?1:0)):null}};
report.deltas=rows.length?{brier:report.model.brier-report.market.brier,logLoss:report.model.logLoss-report.market.logLoss,accuracy:report.model.accuracy-report.market.accuracy}:null;
report.promotion={samplePass:rows.length>=150,beatsMarketBrier:rows.length?report.model.brier<report.market.brier:false,beatsMarketLogLoss:rows.length?report.model.logLoss<report.market.logLoss:false,
  decision:rows.length>=150&&report.model.brier<report.market.brier&&report.model.logLoss<report.market.logLoss?"MARKET_BENCHMARK_PASS":"RESEARCH",canQualify:false,canAuthorize:false};
fs.mkdirSync("artifacts",{recursive:true});fs.writeFileSync("artifacts/soccer-v3-market-replay.json",JSON.stringify(report,null,2));fs.writeFileSync("artifacts/soccer-v3-market-replay-rows.jsonl",rows.map(x=>JSON.stringify(x)).join("\n")+"\n");console.log(JSON.stringify(report,null,2));
function brier(p,o){return(["H","D","A"].reduce((s,k)=>s+(p[k]-(k===o?1:0))**2,0))/3;}
function argmax(p){return["H","D","A"].sort((a,b)=>p[b]-p[a])[0];}
