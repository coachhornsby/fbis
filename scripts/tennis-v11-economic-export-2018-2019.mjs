#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { TennisDeepState, simulateTennisDeepV11 } from "../functions/lib/tennisTwoSidedV11.js";

const YEARS=Array.from({length:10},(_,i)=>2010+i);
const TRAIN_START=2014, TRAIN_END=2017, HOLDOUT_START=2018, HOLDOUT_END=2019;
const SIMS=Math.max(200,Number(process.env.TENNIS_ECON_EXPORT_SIMS||500));
const OUT=process.env.TENNIS_ECON_EXPORT_OUT||"artifacts/tennis-v11-economic-2018-2019.jsonl";
const REPORT=process.env.TENNIS_ECON_EXPORT_REPORT||"artifacts/tennis-v11-economic-2018-2019-summary.json";
const MIRROR="https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const logit=p=>Math.log(clamp(p,1e-6,1-1e-6)/(1-clamp(p,1e-6,1-1e-6)));
const logistic=z=>1/(1+Math.exp(-z));
const round=(v,d=6)=>v==null||!Number.isFinite(v)?null:Number(v.toFixed(d));
const surfaceKey=s=>{s=String(s||"hard").toLowerCase();return s.includes("clay")?"clay":s.includes("grass")?"grass":"hard"};

function parseCsv(text){
  const rows=[];let row=[],field="",q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')q=false;else field+=ch;}
    else{if(ch==='"')q=true;else if(ch===","){row.push(field);field="";}else if(ch==="\n"){row.push(field);rows.push(row);row=[];field="";}else if(ch!=="\r")field+=ch;}
  }
  if(field||row.length){row.push(field);rows.push(row);}
  const h=rows.shift()||[];
  return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??""])));
}
async function fetchText(url){
  const r=await fetch(url,{headers:{"user-agent":"FBIS tennis private economic validation"}});
  if(!r.ok)throw new Error(`${r.status} ${url}`);
  return r.text();
}
function dateKey(r){return String(r.tourney_date||"")}
function eventKey(r,t){return `${t}|${r.tourney_id||r.tourney_name}|${dateKey(r)}`}
function idOf(r,s){return String(r[`${s}_id`]||r[`${s}_name`]||"").trim()}
function orientation(r,t){
  const raw=`${t}|${r.tourney_id}|${r.match_num}|${r.winner_id}|${r.loser_id}`;
  let h=2166136261;
  for(const ch of raw){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}
  return (h>>>0)%2===0;
}
function rankFeature(r){
  const a=finite(r.p1Rank),b=finite(r.p2Rank);
  return a&&b?Math.log((b+5)/(a+5)):0;
}
function fitCalibration(rows){
  let best=null;
  for(let a=.10;a<=.70+1e-9;a+=.025)for(let b=.10;b<=1.40+1e-9;b+=.05){
    const ps=rows.map(r=>logistic(a*logit(r.deepRaw)+b*rankFeature(r)));
    const br=mean(ps.map((p,i)=>(p-rows[i].actualP1Win)**2));
    if(!best||br<best.brier)best={a:round(a,3),b:round(b,3),brier:br};
  }
  return best;
}
function summarize(rows,key){
  if(!rows.length)return {n:0};
  const ps=rows.map(r=>r[key]),ys=rows.map(r=>r.actualP1Win);
  return {
    n:rows.length,
    accuracy:round(mean(ps.map((p,i)=>((p>=.5)?1:0)===ys[i]?1:0))),
    brier:round(mean(ps.map((p,i)=>(p-ys[i])**2))),
    logLoss:round(mean(ps.map((p,i)=>-(ys[i]*Math.log(clamp(p,1e-9,1-1e-9))+(1-ys[i])*Math.log(clamp(1-p,1e-9,1-1e-9))))))
  };
}

const all=[];
for(const tour of ["atp","wta"])for(const year of YEARS){
  try{
    const txt=await fetchText(`${MIRROR}/${tour}/${tour}_matches_${year}.csv`);
    for(const r of parseCsv(txt))all.push({...r,_tour:tour,_year:year});
    process.stderr.write(`loaded ${tour} ${year}\n`);
  }catch(e){process.stderr.write(`skip ${tour} ${year}: ${e.message}\n`)}
}
all.sort((a,b)=>dateKey(a).localeCompare(dateKey(b))||eventKey(a,a._tour).localeCompare(eventKey(b,b._tour))||String(a.match_num||"").localeCompare(String(b.match_num||"")));

const state={atp:new TennisDeepState("atp"),wta:new TennisDeepState("wta")};
const rows=[];
let i=0;
while(i<all.length){
  const ek=eventKey(all[i],all[i]._tour);
  let j=i;while(j<all.length&&eventKey(all[j],all[j]._tour)===ek)j++;
  const event=all.slice(i,j),tour=event[0]._tour,S=state[tour];
  for(const r of event){
    if(r._year<TRAIN_START||r._year>HOLDOUT_END)continue;
    const wi=idOf(r,"winner"),li=idOf(r,"loser"),surface=surfaceKey(r.surface);
    if(!wi||!li||!/Completed|^$/i.test(String(r.comment||"")))continue;
    const wp=S.profile(wi,r.winner_name,surface),lp=S.profile(li,r.loser_name,surface);
    if(Math.min(wp.historyMatches,lp.historyMatches)<3)continue;
    const winnerFirst=orientation(r,tour);
    const p1=winnerFirst?wp:lp,p2=winnerFirst?lp:wp;
    const p1Name=winnerFirst?r.winner_name:r.loser_name,p2Name=winnerFirst?r.loser_name:r.winner_name;
    const p1Rank=finite(r[winnerFirst?"winner_rank":"loser_rank"]),p2Rank=finite(r[winnerFirst?"loser_rank":"winner_rank"]);
    const id=`econ-export|${tour}|${r.tourney_id}|${r.match_num}`;
    const proj=simulateTennisDeepV11({id,tour,surface,bestOf:Number(r.best_of)||3,player1:p1,player2:p2},{simulations:SIMS},{seed:id,researchBacktest:true});
    rows.push({
      tour,year:r._year,date:String(r.tourney_date||""),tournament:r.tourney_name||"",tourneyId:r.tourney_id||"",
      round:r.round||"",surface,bestOf:Number(r.best_of)||3,
      player1Name:p1Name,player2Name:p2Name,p1Rank,p2Rank,
      actualP1Win:winnerFirst?1:0,deepRaw:proj.match.pPlayer1Win
    });
  }
  for(const r of event)S.update(r,surfaceKey(r.surface));
  i=j;
}

const train=rows.filter(r=>r.year>=TRAIN_START&&r.year<=TRAIN_END);
const holdout=rows.filter(r=>r.year>=HOLDOUT_START&&r.year<=HOLDOUT_END);
if(train.length<5000||holdout.length<5000)throw new Error(`insufficient sample train=${train.length} holdout=${holdout.length}`);
const calibration=fitCalibration(train);
for(const r of holdout)r.deepCalibrated=logistic(calibration.a*logit(r.deepRaw)+calibration.b*rankFeature(r));

const report={
  generatedAt:new Date().toISOString(),
  model:"TENNIS-FBIS-v1.1-DEEP",
  design:{warmupYears:"2010-2013",calibrationYears:"2014-2017",economicHoldoutYears:"2018-2019",eventFreeze:true,futureLeakage:false,simulationsPerMatch:SIMS},
  sample:{train:train.length,holdout:holdout.length,atp:holdout.filter(r=>r.tour==="atp").length,wta:holdout.filter(r=>r.tour==="wta").length},
  calibration,
  predictive:{raw:summarize(holdout,"deepRaw"),calibrated:summarize(holdout,"deepCalibrated")},
  byTour:{
    atp:summarize(holdout.filter(r=>r.tour==="atp"),"deepCalibrated"),
    wta:summarize(holdout.filter(r=>r.tour==="wta"),"deepCalibrated")
  },
  governance:{maturity:"RESEARCH",canAuthorizeWager:false}
};
await fs.mkdir(path.dirname(OUT),{recursive:true});
await fs.writeFile(OUT,holdout.map(r=>JSON.stringify(r)).join("\n")+"\n");
await fs.writeFile(REPORT,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
