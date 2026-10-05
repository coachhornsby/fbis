#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { simulateTennisMatch } from "../functions/lib/tennisFbisV1.js";
import { TennisDeepState, simulateTennisDeepV11 } from "../functions/lib/tennisTwoSidedV11.js";

const YEARS=String(process.env.TENNIS_DEEP_YEARS||"2018-2026").split(",").flatMap(x=>{
  const m=x.match(/^(\d{4})-(\d{4})$/);if(!m)return [Number(x)];
  return Array.from({length:Number(m[2])-Number(m[1])+1},(_,i)=>Number(m[1])+i);
}).filter(Number.isFinite);
const SIMS=Math.max(100,Number(process.env.TENNIS_DEEP_SIMS||200));
const OUT=process.env.TENNIS_DEEP_OUT||"research/tennis/deep-v1-1-latest.json";
const MIRROR="https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const round=(v,d=5)=>v==null||!Number.isFinite(v)?null:Number(v.toFixed(d));
const logit=p=>Math.log(clamp(p,1e-6,1-1e-6)/(1-clamp(p,1e-6,1-1e-6)));
const logistic=z=>1/(1+Math.exp(-z));
const surfaceKey=s=>{s=String(s||"hard").toLowerCase();return s.includes("clay")?"clay":s.includes("grass")?"grass":"hard"};

function parseCsv(text){
  const rows=[];let row=[],field="",q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')q=false;else field+=ch;}
    else{if(ch==='"')q=true;else if(ch===","){row.push(field);field="";}else if(ch==="\n"){row.push(field);rows.push(row);row=[];field="";}else if(ch!=="\r")field+=ch;}
  }
  if(field||row.length){row.push(field);rows.push(row);}
  const h=rows.shift()||[];return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??""])));
}
async function fetchText(url){const r=await fetch(url,{headers:{"user-agent":"FBIS tennis deep research"}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.text()}
function dateKey(r){return String(r.tourney_date||"")}
function eventKey(r,t){return `${t}|${r.tourney_id||r.tourney_name}|${dateKey(r)}`}
function idOf(r,s){return String(r[`${s}_id`]||r[`${s}_name`]||"").trim()}
function scoreOutcome(score){
  const s=String(score||"").trim().replace(/\s+/g," ");
  if(!s||/W\/O|RET|DEF|ABD|Walkover/i.test(s)||/[\[\]]/.test(s))return null;
  const sets=s.split(" ").map(x=>x.match(/^(\d+)-(\d+)(?:\([^)]*\))?$/)).filter(Boolean).map(m=>[Number(m[1]),Number(m[2])]).filter(x=>x[0]<=7&&x[1]<=7);
  if(sets.length<2)return null;const wg=sets.reduce((n,x)=>n+x[0],0),lg=sets.reduce((n,x)=>n+x[1],0);
  return {winnerGames:wg,loserGames:lg,totalGames:wg+lg,totalSets:sets.length};
}
function actualBpWon(r,side){const o=side==="w"?"l":"w",f=finite(r[`${o}_bpFaced`]),s=finite(r[`${o}_bpSaved`]);return f==null||s==null?null:Math.max(0,f-s)}
function orientation(r,t){const raw=`${t}|${r.tourney_id}|${r.match_num}|${r.winner_id}|${r.loser_id}`;let h=2166136261;for(const ch of raw){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0)%2===0}

class LegacyState{
  constructor(tour){this.tour=tour;this.players=new Map()}
  p(id){if(!this.players.has(id))this.players.set(id,{elo:1500,surface:{hard:1500,clay:1500,grass:1500},svpt:0,serviceWon:0,ace:0,df:0,returnPts:0,returnWon:0,matches:0});return this.players.get(id)}
  profile(id,name,surface){
    const p=this.p(id),P=this.tour==="wta"?{serve:.59,ret:.41,ace:.045,df:.045}:{serve:.635,ret:.365,ace:.075,df:.035};
    const w=Math.min(1,p.svpt/800),rw=Math.min(1,p.returnPts/800);
    return {id,name,elo:p.elo,surfaceElo:{[surface]:p.surface[surface]},servePointWinPct:(1-w)*P.serve+w*(p.svpt?p.serviceWon/p.svpt:P.serve),returnPointWinPct:(1-rw)*P.ret+rw*(p.returnPts?p.returnWon/p.returnPts:P.ret),aceRate:(1-w)*P.ace+w*(p.svpt?p.ace/p.svpt:P.ace),doubleFaultRate:(1-w)*P.df+w*(p.svpt?p.df/p.svpt:P.df),historicalMatches:p.matches}
  }
  update(r,surface){
    const wi=idOf(r,"winner"),li=idOf(r,"loser");if(!wi||!li)return;const w=this.p(wi),l=this.p(li),ew=1/(1+10**((l.elo-w.elo)/400));
    w.elo+=24*(1-ew);l.elo-=24*ew;const es=1/(1+10**((l.surface[surface]-w.surface[surface])/400));w.surface[surface]+=28*(1-es);l.surface[surface]-=28*es;
    for(const [side,p,o] of [["w",w,"l"],["l",l,"w"]]){const sv=finite(r[`${side}_svpt`]),w1=finite(r[`${side}_1stWon`]),w2=finite(r[`${side}_2ndWon`]),a=finite(r[`${side}_ace`]),df=finite(r[`${side}_df`]),osv=finite(r[`${o}_svpt`]),ow1=finite(r[`${o}_1stWon`]),ow2=finite(r[`${o}_2ndWon`]);if([sv,w1,w2,a,df,osv,ow1,ow2].every(x=>x!=null)&&sv>0&&osv>0){p.svpt+=sv;p.serviceWon+=w1+w2;p.ace+=a;p.df+=df;p.returnPts+=osv;p.returnWon+=osv-(ow1+ow2)}p.matches++}
  }
}
function rankFeature(r){const a=finite(r.p1Rank),b=finite(r.p2Rank);return a&&b?Math.log((b+5)/(a+5)):0}
function fitCalibration(rows,key){
  let best=null;
  for(let a=.10;a<=.70+1e-9;a+=.025)for(let b=.10;b<=1.40+1e-9;b+=.05){
    const ps=rows.map(r=>logistic(a*logit(r[key])+b*rankFeature(r))),ys=rows.map(r=>r.actualP1Win);
    const br=mean(ps.map((p,i)=>(p-ys[i])**2));
    if(!best||br<best.brier)best={a:round(a,3),b:round(b,3),brier:br};
  }
  return best;
}
function summarizeMatch(rows,key,cal=null){
  const ps=rows.map(r=>cal?logistic(cal.a*logit(r[key])+cal.b*rankFeature(r)):r[key]),ys=rows.map(r=>r.actualP1Win);
  const bins=Array.from({length:10},(_,i)=>({n:0,p:0,y:0,lo:i/10,hi:(i+1)/10}));
  ps.forEach((p,i)=>{const b=bins[Math.min(9,Math.floor(p*10))];b.n++;b.p+=p;b.y+=ys[i]});
  const calibration=bins.filter(b=>b.n).map(b=>({range:`${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`,n:b.n,meanProbability:round(b.p/b.n),observedWinRate:round(b.y/b.n)}));
  return {n:rows.length,accuracy:round(mean(ps.map((p,i)=>(p>=.5?1:0)===ys[i]?1:0))),brier:round(mean(ps.map((p,i)=>(p-ys[i])**2))),logLoss:round(mean(ps.map((p,i)=>-(ys[i]*Math.log(clamp(p,1e-9,1-1e-9))+(1-ys[i])*Math.log(clamp(1-p,1e-9,1-1e-9)))))),maxCalibrationError:round(Math.max(...calibration.map(b=>Math.abs(b.meanProbability-b.observedWinRate)))),calibration}
}
function propSummary(rows,pred,actual){
  const rr=rows.filter(r=>finite(r[pred])!=null&&finite(r[actual])!=null);if(!rr.length)return {n:0};
  const errs=rr.map(r=>r[pred]-r[actual]);return {n:rr.length,mae:round(mean(errs.map(Math.abs))),rmse:round(Math.sqrt(mean(errs.map(x=>x*x)))),bias:round(mean(errs))}
}
function allPropMetrics(rows,prefix){
  return {
    totalGames:propSummary(rows,`${prefix}TotalGames`,"actualTotalGames"),
    totalSets:propSummary(rows,`${prefix}TotalSets`,"actualTotalSets"),
    gamesWon:propSummary(rows,`${prefix}P1Games`,"actualP1Games"),
    aces:propSummary(rows,`${prefix}P1Aces`,"actualP1Aces"),
    doubleFaults:propSummary(rows,`${prefix}P1Df`,"actualP1Df"),
    breakPointsWon:propSummary(rows,`${prefix}P1Bp`,"actualP1Bp"),
  }
}

const all=[];
for(const tour of ["atp","wta"])for(const year of YEARS){try{const txt=await fetchText(`${MIRROR}/${tour}/${tour}_matches_${year}.csv`);for(const r of parseCsv(txt))all.push({...r,_tour:tour,_year:year});process.stderr.write(`loaded ${tour} ${year}\n`)}catch(e){process.stderr.write(`skip ${tour} ${year}: ${e.message}\n`)}}
all.sort((a,b)=>dateKey(a).localeCompare(dateKey(b))||eventKey(a,a._tour).localeCompare(eventKey(b,b._tour))||String(a.match_num||"").localeCompare(String(b.match_num||"")));

const legacy={atp:new LegacyState("atp"),wta:new LegacyState("wta")};
const deep={atp:new TennisDeepState("atp"),wta:new TennisDeepState("wta")};
const rows=[];
let i=0;
while(i<all.length){
  const ek=eventKey(all[i],all[i]._tour);let j=i;while(j<all.length&&eventKey(all[j],all[j]._tour)===ek)j++;
  const event=all.slice(i,j),tour=event[0]._tour,L=legacy[tour],D=deep[tour];
  for(const r of event){
    if(r._year<2020)continue;const outcome=scoreOutcome(r.score),surface=surfaceKey(r.surface);if(!outcome)continue;
    const wi=idOf(r,"winner"),li=idOf(r,"loser");if(!wi||!li)continue;
    const lpw=L.profile(wi,r.winner_name,surface),lpl=L.profile(li,r.loser_name,surface),dpw=D.profile(wi,r.winner_name,surface),dpl=D.profile(li,r.loser_name,surface);
    if(Math.min(lpw.historicalMatches,lpl.historicalMatches,dpw.historyMatches,dpl.historyMatches)<3)continue;
    const winnerFirst=orientation(r,tour);
    const l1=winnerFirst?lpw:lpl,l2=winnerFirst?lpl:lpw,d1=winnerFirst?dpw:dpl,d2=winnerFirst?dpl:dpw;
    const id=`deep|${tour}|${r.tourney_id}|${r.match_num}`,bestOf=Number(r.best_of)||3;
    const pv1=simulateTennisMatch({id,surface,bestOf,player1:l1,player2:l2},{simulations:SIMS},{seed:id+"|v1",researchBacktest:true});
    const pd=simulateTennisDeepV11({id,surface,bestOf,tour,player1:d1,player2:d2},{simulations:SIMS},{seed:id+"|deep",researchBacktest:true});
    const side=winnerFirst?"w":"l",p1Rank=finite(r[winnerFirst?"winner_rank":"loser_rank"]),p2Rank=finite(r[winnerFirst?"loser_rank":"winner_rank"]);
    rows.push({
      tour,year:r._year,surface,p1Rank,p2Rank,actualP1Win:winnerFirst?1:0,
      v1Win:pv1.match.pPlayer1Win,deepWin:pd.match.pPlayer1Win,
      v1TotalGames:pv1.match.totalGames.mean,deepTotalGames:pd.match.totalGames.mean,actualTotalGames:outcome.totalGames,
      v1TotalSets:pv1.match.totalSets.mean,deepTotalSets:pd.match.totalSets.mean,actualTotalSets:outcome.totalSets,
      v1P1Games:pv1.playerMetrics[0].total_games_won.mean,deepP1Games:pd.playerMetrics[0].total_games_won.mean,actualP1Games:winnerFirst?outcome.winnerGames:outcome.loserGames,
      v1P1Aces:pv1.playerMetrics[0].aces.mean,deepP1Aces:pd.playerMetrics[0].aces.mean,actualP1Aces:finite(r[`${side}_ace`]),
      v1P1Df:pv1.playerMetrics[0].double_faults.mean,deepP1Df:pd.playerMetrics[0].double_faults.mean,actualP1Df:finite(r[`${side}_df`]),
      v1P1Bp:pv1.playerMetrics[0].break_points_won.mean,deepP1Bp:pd.playerMetrics[0].break_points_won.mean,actualP1Bp:actualBpWon(r,side),
    });
  }
  for(const r of event){const s=surfaceKey(r.surface);L.update(r,s);D.update(r,s)}
  i=j;
}
const train=rows.filter(r=>r.year<=2023),holdout=rows.filter(r=>r.year>=2024);
const calV1=fitCalibration(train,"v1Win"),calDeep=fitCalibration(train,"deepWin");
const report={
  generatedAt:new Date().toISOString(),model:"TENNIS-FBIS-v1.1-DEEP / TENNIS-PLAYER-v1.1-DEEP",
  source:{name:"Jeff Sackmann / Tennis Abstract archive mirror",license:"CC BY-NC-SA 4.0",productionDependency:false,permittedUse:"research/backtest only"},
  design:{trainYears:"2020-2023",holdoutYears:"2024-2026",eventFreeze:true,twoSided:true,surfaceSpecific:true,recencyWeighted:true,features:["first serve in","first serve points won","second serve points won","serve points won","return points won","aces for","aces allowed","double faults for","double faults received","break points saved","break points faced per service game","break points created per return game","break point conversion","service points per game","overall Elo","surface Elo","rank calibration"],simulationsPerMatch:SIMS},
  sample:{train:train.length,holdout:holdout.length,total:rows.length},
  calibration:{v1:calV1,deep:calDeep},
  match:{holdout:{v1Raw:summarizeMatch(holdout,"v1Win"),deepRaw:summarizeMatch(holdout,"deepWin"),v1Calibrated:summarizeMatch(holdout,"v1Win",calV1),deepCalibrated:summarizeMatch(holdout,"deepWin",calDeep)}},
  props:{holdout:{v1:allPropMetrics(holdout,"v1"),deep:allPropMetrics(holdout,"deep")}},
  byTour:Object.fromEntries(["atp","wta"].map(t=>[t,{match:{v1:summarizeMatch(holdout.filter(r=>r.tour===t),"v1Win",calV1),deep:summarizeMatch(holdout.filter(r=>r.tour===t),"deepWin",calDeep)},props:{v1:allPropMetrics(holdout.filter(r=>r.tour===t),"v1"),deep:allPropMetrics(holdout.filter(r=>r.tour===t),"deep")}}])),
  bySurface:Object.fromEntries(["hard","clay","grass"].map(s=>[s,{match:{v1:summarizeMatch(holdout.filter(r=>r.surface===s),"v1Win",calV1),deep:summarizeMatch(holdout.filter(r=>r.surface===s),"deepWin",calDeep)},props:{v1:allPropMetrics(holdout.filter(r=>r.surface===s),"v1"),deep:allPropMetrics(holdout.filter(r=>r.surface===s),"deep")}}])),
};
const m=report.match.holdout,p=report.props.holdout;
report.verdict={
  matchPredictivePromotion:m.deepCalibrated.brier<m.v1Calibrated.brier&&m.deepCalibrated.logLoss<m.v1Calibrated.logLoss&&m.deepCalibrated.accuracy>=m.v1Calibrated.accuracy,
  propImprovement:{
    totalGames:p.deep.totalGames.mae<p.v1.totalGames.mae,
    totalSets:p.deep.totalSets.mae<p.v1.totalSets.mae,
    gamesWon:p.deep.gamesWon.mae<p.v1.gamesWon.mae,
    aces:p.deep.aces.mae<p.v1.aces.mae,
    doubleFaults:p.deep.doubleFaults.mae<p.v1.doubleFaults.mae,
    breakPointsWon:p.deep.breakPointsWon.mae<p.v1.breakPointsWon.mae,
  },
  wagerPromotion:false,
  reasons:["historical sportsbook/PrizePicks prices not validated","research source not a production dependency"],
};
await fs.mkdir(path.dirname(OUT),{recursive:true});await fs.writeFile(OUT,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
