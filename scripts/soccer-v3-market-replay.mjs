#!/usr/bin/env node
import fs from "node:fs";
const legacy=read(process.argv[2]||"artifacts/legacy-market/soccer-market-benchmark-rows.jsonl");
const v3=read(process.argv[3]||"artifacts/v3/soccer-v3-walkforward-rows.jsonl");
function read(p){return fs.readFileSync(p,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);}
function norm(s){return String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/\b(fc|cf|sc|afc|club|de|futbol|football|soccer)\b/g," ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");}
function date(x){return String(x?.date||x?.start||"").slice(0,10);}
function key(x){return [x.league,date(x),norm(x.homeTeam),norm(x.awayTeam)].join("|");}
function brier(p,o){return(["H","D","A"].reduce((s,k)=>s+(p[k]-(k===o?1:0))**2,0))/3;}
function argmax(p){return["H","D","A"].sort((a,b)=>p[b]-p[a])[0];}
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const by=new Map(v3.map(x=>[key(x),x])),rows=[];
for(const old of legacy){
  const cur=by.get(key(old));if(!cur)continue;
  const market={H:Number(old.marketHome),D:Number(old.marketDraw),A:Number(old.marketAway)};
  const v2p={H:Number(cur.v2Home),D:Number(cur.v2Draw),A:Number(cur.v2Away)};
  const v3p={H:Number(cur.v3Home??cur.pHome),D:Number(cur.v3Draw??cur.pDraw),A:Number(cur.v3Away??cur.pAway)};
  const outcome=String(cur.outcome||old.outcome||"");
  if(!["H","D","A"].includes(outcome))continue;
  if([...Object.values(market),...Object.values(v2p),...Object.values(v3p)].some(x=>!Number.isFinite(x)))continue;
  rows.push({...cur,marketHome:market.H,marketDraw:market.D,marketAway:market.A,
    v2MarketBrier:brier(v2p,outcome),v3MarketBrier:brier(v3p,outcome),marketBrier:brier(market,outcome),
    v2MarketLogLoss:-Math.log(Math.max(1e-12,v2p[outcome])),v3MarketLogLoss:-Math.log(Math.max(1e-12,v3p[outcome])),marketLogLoss:-Math.log(Math.max(1e-12,market[outcome])),
    v2MarketCorrect:argmax(v2p)===outcome,v3MarketCorrect:argmax(v3p)===outcome,marketCorrect:argmax(market)===outcome});
}
function metrics(prefix){
  return{
    brier:mean(rows.map(x=>x[prefix+"Brier"])),
    logLoss:mean(rows.map(x=>x[prefix+"LogLoss"])),
    accuracy:rows.length?mean(rows.map(x=>x[prefix+"Correct"]?1:0)):null
  };
}
const report={generatedAt:new Date().toISOString(),modelId:"SOCCER-FBIS-v3.1",benchmark:"REPLAY_EXISTING_ZEN_ACTION_NO_VIG_1X2",sourceSample:"soccer-market-benchmark-37186030331",oldMatched:legacy.length,matched:rows.length,costUsd:0,
  v2:metrics("v2Market"),v3:metrics("v3Market"),market:metrics("market"),
  derivativeMarketHistory:{BTTS:"UNAVAILABLE",totals:"UNAVAILABLE",asianHandicap:"UNAVAILABLE"}};
report.deltas={
  v3VsV2:{brier:report.v3.brier-report.v2.brier,logLoss:report.v3.logLoss-report.v2.logLoss,accuracy:report.v3.accuracy-report.v2.accuracy},
  v3VsMarket:{brier:report.v3.brier-report.market.brier,logLoss:report.v3.logLoss-report.market.logLoss,accuracy:report.v3.accuracy-report.market.accuracy}
};
report.promotion={samplePass:rows.length>=150,beatsV2Brier:rows.length?report.v3.brier<report.v2.brier:false,beatsMarketBrier:rows.length?report.v3.brier<report.market.brier:false,beatsMarketLogLoss:rows.length?report.v3.logLoss<report.market.logLoss:false,
  decision:"RESEARCH",canQualify:false,canAuthorize:false,reason:"Phase 3 evidence only; derivative historical market prices unavailable and prospective shadow still required"};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/soccer-v3-market-replay.json",JSON.stringify(report,null,2));
fs.writeFileSync("artifacts/soccer-v3-market-replay-rows.jsonl",rows.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
