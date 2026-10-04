#!/usr/bin/env node
import fs from "node:fs";
import { runActionApifyShadow, createResearchBudget, americanToImpliedProb } from "../functions/lib/actionApifyShadow.js";

const rowsPath=process.argv[2]||"artifacts/soccer-form-walkforward-rows.jsonl";
const budgetUsd=Number(process.env.SOCCER_MARKET_BENCHMARK_BUDGET_USD||3.0);
const maxDates=Math.max(1,Math.min(12,Number(process.env.SOCCER_MARKET_BENCHMARK_DATES||6)));
const maxGames=Math.max(10,Math.min(50,Number(process.env.SOCCER_MARKET_BENCHMARK_MAX_GAMES||30)));
const minMatched=Math.max(1,Number(process.env.SOCCER_MARKET_BENCHMARK_MIN_MATCHED||25));
const source=fs.readFileSync(rowsPath,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const byDate=new Map();
for(const r of source){const d=String(r.start||"").slice(0,10);if(!d)continue;(byDate.get(d)||byDate.set(d,[]).get(d)).push(r);}
const eligible=[...byDate.entries()].filter(([,rs])=>rs.length>=3).sort((a,b)=>a[0].localeCompare(b[0]));
const dates=sampleEvenly(eligible.map(([d])=>d),maxDates);
const budget=createResearchBudget({limitUsd:budgetUsd});
const waitSecs=Math.max(30,Math.min(90,Number(process.env.SOCCER_MARKET_WAIT_SECS||75)));
const boundedFetch=(url,init={})=>fetch(url,{...init,signal:AbortSignal.timeout((waitSecs+10)*1000)});
const pairs=[]; const runSummary=[];

for(const date of dates){
  const run=await runActionApifyShadow(process.env,{leagues:["soccer"],date,maxGames,freePlan:false,includeExpertPicks:false,includeLineMovement:false,includeProps:false,includeStandings:false,includeInjuries:false,budget,testId:`soccer-market-${date}`,waitSecs,fetchImpl:boundedFetch});
  runSummary.push({date,ok:run.ok,gamesReturned:run.gamesReturned||0,cost:run.estimatedCostUsd||0,error:run.error||null});
  if(!run.ok){if(run.blocked)break;continue;}
  const modelRows=byDate.get(date)||[];
  for(const m of modelRows){
    const a=bestMatch(m,run.rows||[]);
    if(!a)continue;
    const h=americanToImpliedProb(a.consensus?.moneylineHome),d=americanToImpliedProb(a.consensus?.moneylineDraw),w=americanToImpliedProb(a.consensus?.moneylineAway);
    if([h,d,w].some(x=>x==null))continue;
    const sum=h+d+w;if(!(sum>0))continue;
    const market={H:h/sum,D:d/sum,A:w/sum};
    const model={H:Number(m.pHome),D:Number(m.pDraw),A:Number(m.pAway)};
    const outcome=Number(m.actualHome)>Number(m.actualAway)?"H":Number(m.actualHome)<Number(m.actualAway)?"A":"D";
    const prices={H:Number(a.consensus?.moneylineHome),D:Number(a.consensus?.moneylineDraw),A:Number(a.consensus?.moneylineAway)};
    const edges={H:model.H-market.H,D:model.D-market.D,A:model.A-market.A};
    const betSide=argmax(edges);
    const betEdge=Number(edges[betSide]);
    const betPrice=prices[betSide];
    const flatProfit=Number.isFinite(betPrice)&&betEdge>0?(betSide===outcome?americanProfit(betPrice):-1):null;
    pairs.push({...m,actionGameId:a.actionGameId,marketHome:market.H,marketDraw:market.D,marketAway:market.A,
      priceHome:prices.H,priceDraw:prices.D,priceAway:prices.A,
      edgeHome:edges.H,edgeDraw:edges.D,edgeAway:edges.A,betSide,betEdge,betPrice,flatProfit,
      modelBrier:brier(model,outcome),marketBrier:brier(market,outcome),
      modelLogLoss:-Math.log(Math.max(1e-12,model[outcome])),marketLogLoss:-Math.log(Math.max(1e-12,market[outcome])),
      modelCorrect:argmax(model)===outcome,marketCorrect:argmax(market)===outcome});
  }
}
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const report={
 generatedAt:new Date().toISOString(),modelId:"SOCCER-FBIS-v1",benchmark:"ZEN_ACTION_NO_VIG_1X2",datesRequested:dates.length,
 datesCompleted:runSummary.filter(x=>x.ok).length,matched:pairs.length,budgetLimitUsd:budgetUsd,estimatedSpendUsd:budget.spentUsd,
 model:{brier:mean(pairs.map(x=>x.modelBrier)),logLoss:mean(pairs.map(x=>x.modelLogLoss)),accuracy:pairs.length?pairs.filter(x=>x.modelCorrect).length/pairs.length:null},
 market:{brier:mean(pairs.map(x=>x.marketBrier)),logLoss:mean(pairs.map(x=>x.marketLogLoss)),accuracy:pairs.length?pairs.filter(x=>x.marketCorrect).length/pairs.length:null},
 deltas:{brier:pairs.length?mean(pairs.map(x=>x.modelBrier))-mean(pairs.map(x=>x.marketBrier)):null,logLoss:pairs.length?mean(pairs.map(x=>x.modelLogLoss))-mean(pairs.map(x=>x.marketLogLoss)):null,accuracy:pairs.length?(pairs.filter(x=>x.modelCorrect).length-pairs.filter(x=>x.marketCorrect).length)/pairs.length:null},
 bettingResearch:{
   note:"Consensus/ACTION observations are research prices, not execution authority.",
   positiveEdgeN:pairs.filter(x=>x.flatProfit!=null).length,
   positiveEdgeFlatStakeRoi:roi(pairs.filter(x=>x.flatProfit!=null)),
   edgeBuckets:edgeBuckets(pairs),
 },
 promotion:{samplePass:pairs.length>=minMatched,beatsMarketBrier:pairs.length?mean(pairs.map(x=>x.modelBrier))<mean(pairs.map(x=>x.marketBrier)):false,beatsMarketLogLoss:pairs.length?mean(pairs.map(x=>x.modelLogLoss))<mean(pairs.map(x=>x.marketLogLoss)):false,decision:"RESEARCH",canQualify:false,canAuthorize:false},
 runs:runSummary
};
report.promotion.decision=report.promotion.samplePass&&report.promotion.beatsMarketBrier&&report.promotion.beatsMarketLogLoss?"MARKET_BENCHMARK_PASS":"RESEARCH";
fs.mkdirSync("artifacts",{recursive:true});fs.writeFileSync("artifacts/soccer-market-benchmark.json",JSON.stringify(report,null,2));fs.writeFileSync("artifacts/soccer-market-benchmark-rows.jsonl",pairs.map(x=>JSON.stringify(x)).join("\n")+"\n");console.log(JSON.stringify(report,null,2));
if(!report.promotion.samplePass)process.exitCode=3;

function norm(s){return String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/\b(fc|cf|sc|afc|club|de|futbol|football|soccer)\b/g," ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");}
function bestMatch(m,rows){const h=norm(m.homeTeam),a=norm(m.awayTeam);const exact=rows.filter(r=>norm(r.homeTeam)===h&&norm(r.awayTeam)===a);if(exact.length===1)return exact[0];const score=r=>sim(h,norm(r.homeTeam))+sim(a,norm(r.awayTeam));const ranked=rows.map(r=>[score(r),r]).sort((x,y)=>y[0]-x[0]);return ranked[0]?.[0]>=1.5&&(ranked.length<2||ranked[0][0]-ranked[1][0]>=0.15)?ranked[0][1]:null;}
function sim(a,b){if(a===b)return 1;const A=new Set(a.split(" ")),B=new Set(b.split(" "));const inter=[...A].filter(x=>B.has(x)).length;return inter/Math.max(A.size,B.size,1);}
function brier(p,o){return (["H","D","A"].reduce((s,k)=>s+(Number(p[k])-(k===o?1:0))**2,0))/3;}
function argmax(p){return ["H","D","A"].sort((a,b)=>Number(p[b])-Number(p[a]))[0];}
function americanProfit(price){const x=Number(price);if(!Number.isFinite(x)||x===0)return null;return x>0?x/100:100/Math.abs(x);}
function roi(xs){return xs.length?xs.reduce((s,x)=>s+Number(x.flatProfit||0),0)/xs.length:null;}
function edgeBuckets(xs){
  const bins=[[0,0.02],[0.02,0.04],[0.04,0.06],[0.06,0.08],[0.08,Infinity]];
  return bins.map(([lo,hi])=>{const rows=xs.filter(x=>x.flatProfit!=null&&x.betEdge>=lo&&x.betEdge<hi);return{lo,hi:Number.isFinite(hi)?hi:null,n:rows.length,roi:roi(rows),avgEdge:rows.length?rows.reduce((s,x)=>s+x.betEdge,0)/rows.length:null};});
}
function sampleEvenly(xs,n){if(xs.length<=n)return xs;if(n<=1)return[xs[0]];const out=[];for(let i=0;i<n;i++)out.push(xs[Math.round(i*(xs.length-1)/(n-1))]);return[...new Set(out)];}
