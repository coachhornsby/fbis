#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { simulateTennisMatch } from "../functions/lib/tennisFbisV1.js";

const YEARS = String(process.env.TENNIS_WF_YEARS || "2018-2026")
  .split(",")
  .flatMap(x=>{
    const m=x.match(/^(\d{4})-(\d{4})$/);
    if(m){const a=Number(m[1]),b=Number(m[2]);return Array.from({length:b-a+1},(_,i)=>a+i);}
    return [Number(x)];
  }).filter(Number.isFinite);
const SIMS = Math.max(100, Number(process.env.TENNIS_WF_SIMS || 250));
const EVAL_START = Number(process.env.TENNIS_WF_EVAL_START || 2020);
const OUT = process.env.TENNIS_WF_OUT || "research/tennis/walkforward-latest.json";
const MIRROR = "https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";
const SOURCE_LICENSE = "CC BY-NC-SA 4.0";
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const mae=(a,b)=>mean(a.map((x,i)=>Math.abs(x-b[i])));
const rmse=(a,b)=>Math.sqrt(mean(a.map((x,i)=>(x-b[i])**2)));
const round=(v,d=5)=>v==null||!Number.isFinite(v)?null:Number(v.toFixed(d));

function parseCsv(text){
  const rows=[];let row=[],field="",q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){
      if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')q=false;
      else field+=ch;
    }else{
      if(ch==='"')q=true;
      else if(ch===","){row.push(field);field="";}
      else if(ch==="\n"){row.push(field);rows.push(row);row=[];field="";}
      else if(ch!=="\r")field+=ch;
    }
  }
  if(field||row.length){row.push(field);rows.push(row);}
  const header=rows.shift()||[];
  return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]??""])));
}
async function fetchText(url){
  const res=await fetch(url,{headers:{"user-agent":"FBIS research walk-forward"}});
  if(!res.ok)throw new Error(`${res.status} ${url}`);
  return res.text();
}
function cleanScore(score){
  return String(score||"").trim().replace(/\s+/g," ");
}
function scoreOutcome(score){
  const s=cleanScore(score);
  if(!s||/W\/O|RET|DEF|ABD|Walkover/i.test(s)||/[\[\]]/.test(s))return null;
  const sets=[];
  for(const tok of s.split(" ")){
    const m=tok.match(/^(\d+)-(\d+)(?:\([^)]*\))?$/);
    if(!m)continue;
    const a=Number(m[1]),b=Number(m[2]);
    if(a>7||b>7)continue;
    sets.push([a,b]);
  }
  if(sets.length<2)return null;
  const wg=sets.reduce((n,x)=>n+x[0],0),lg=sets.reduce((n,x)=>n+x[1],0);
  return {winnerGames:wg,loserGames:lg,totalGames:wg+lg,totalSets:sets.length};
}
function idOf(row,side){
  return String(row[`${side}_id`]||row[`${side}_name`]||"").trim();
}
function dateKey(row){return String(row.tourney_date||"").trim();}
function eventKey(row,tour){return `${tour}|${row.tourney_id||row.tourney_name||""}|${dateKey(row)}`;}
function statPack(row,side){
  const o=side==="w"?"l":"w";
  const svpt=finite(row[`${side}_svpt`]);
  const won1=finite(row[`${side}_1stWon`]);
  const won2=finite(row[`${side}_2ndWon`]);
  const ace=finite(row[`${side}_ace`]);
  const df=finite(row[`${side}_df`]);
  const oppSvpt=finite(row[`${o}_svpt`]);
  const oppWon1=finite(row[`${o}_1stWon`]);
  const oppWon2=finite(row[`${o}_2ndWon`]);
  if([svpt,won1,won2,ace,df,oppSvpt,oppWon1,oppWon2].some(x=>x==null)||svpt<=0||oppSvpt<=0)return null;
  return {
    svpt,serviceWon:won1+won2,ace,df,
    returnPts:oppSvpt,returnWon:oppSvpt-(oppWon1+oppWon2),
  };
}
function actualBpWon(row,side){
  const opp=side==="w"?"l":"w";
  const faced=finite(row[`${opp}_bpFaced`]),saved=finite(row[`${opp}_bpSaved`]);
  return faced==null||saved==null?null:Math.max(0,faced-saved);
}
class State{
  constructor(){this.players=new Map();}
  p(id){
    if(!this.players.has(id))this.players.set(id,{
      elo:1500,surface:{hard:1500,clay:1500,grass:1500},
      svpt:0,serviceWon:0,ace:0,df:0,returnPts:0,returnWon:0,matches:0,
    });
    return this.players.get(id);
  }
  profile(id,name,surface,tour){
    const p=this.p(id),pri=tour==="wta"
      ?{serve:.59,ret:.41,ace:.045,df:.045}
      :{serve:.635,ret:.365,ace:.075,df:.035};
    const w=Math.min(1,p.svpt/800);
    const rw=Math.min(1,p.returnPts/800);
    return {
      id,name,elo:p.elo,
      surfaceElo:{[surface]:p.surface[surface]??1500},
      servePointWinPct:(1-w)*pri.serve+w*(p.svpt?p.serviceWon/p.svpt:pri.serve),
      returnPointWinPct:(1-rw)*pri.ret+rw*(p.returnPts?p.returnWon/p.returnPts:pri.ret),
      aceRate:(1-w)*pri.ace+w*(p.svpt?p.ace/p.svpt:pri.ace),
      doubleFaultRate:(1-w)*pri.df+w*(p.svpt?p.df/p.svpt:pri.df),
      historicalMatches:p.matches,
    };
  }
  update(row,surface){
    const wi=idOf(row,"winner"),li=idOf(row,"loser"); if(!wi||!li)return;
    const w=this.p(wi),l=this.p(li);
    const expected=1/(1+10**((l.elo-w.elo)/400));
    const k=24;
    w.elo+=k*(1-expected);l.elo+=k*(0-expected);
    const ws=w.surface[surface]??1500,ls=l.surface[surface]??1500;
    const es=1/(1+10**((ls-ws)/400)),ks=28;
    w.surface[surface]=ws+ks*(1-es);l.surface[surface]=ls+ks*(0-es);
    for(const [side,p] of [["w",w],["l",l]]){
      const s=statPack(row,side);
      if(s){for(const k2 of ["svpt","serviceWon","ace","df","returnPts","returnWon"])p[k2]+=s[k2];}
      p.matches++;
    }
  }
}
function orientation(row,tour){
  const raw=`${tour}|${row.tourney_id}|${row.match_num}|${row.winner_id}|${row.loser_id}`;
  let h=2166136261;for(const ch of raw){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return (h>>>0)%2===0;
}
function calibration(rows){
  const bins=Array.from({length:10},(_,i)=>({lo:i/10,hi:(i+1)/10,n:0,p:0,y:0}));
  for(const r of rows){
    const idx=Math.min(9,Math.floor(r.p1Win*10));const b=bins[idx];b.n++;b.p+=r.p1Win;b.y+=r.actualP1Win;
  }
  return bins.filter(b=>b.n).map(b=>({range:`${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`,n:b.n,meanProbability:round(b.p/b.n),observedWinRate:round(b.y/b.n)}));
}
function summarize(rows){
  if(!rows.length)return {n:0};
  const probs=rows.map(r=>r.p1Win),ys=rows.map(r=>r.actualP1Win);
  const brier=mean(probs.map((p,i)=>(p-ys[i])**2));
  const logLoss=mean(probs.map((p,i)=>-(ys[i]*Math.log(clamp(p,1e-9,1-1e-9))+(1-ys[i])*Math.log(clamp(1-p,1e-9,1-1e-9)))));
  const acc=mean(probs.map((p,i)=>(p>=.5?1:0)===ys[i]?1:0));
  const rankEligible=rows.filter(r=>r.rankFavoriteCorrect!=null);
  const rankAcc=rankEligible.length?mean(rankEligible.map(r=>r.rankFavoriteCorrect)):null;
  const out={n:rows.length,winnerAccuracy:round(acc),brier:round(brier),logLoss:round(logLoss),rankFavoriteAccuracy:round(rankAcc)};
  for(const [label,pred,actual] of [
    ["totalGames","predTotalGames","actualTotalGames"],["totalSets","predTotalSets","actualTotalSets"],
    ["p1GamesWon","predP1Games","actualP1Games"],["p1Aces","predP1Aces","actualP1Aces"],
    ["p1DoubleFaults","predP1Df","actualP1Df"],["p1BreakPointsWon","predP1Bp","actualP1Bp"]
  ]){
    const rr=rows.filter(r=>finite(r[pred])!=null&&finite(r[actual])!=null);
    if(rr.length)out[label]={n:rr.length,mae:round(mae(rr.map(r=>r[pred]),rr.map(r=>r[actual]))),rmse:round(rmse(rr.map(r=>r[pred]),rr.map(r=>r[actual])))};
  }
  out.calibration=calibration(rows);
  return out;
}

const all=[];
for(const tour of ["atp","wta"]){
  for(const year of YEARS){
    const url=`${MIRROR}/${tour}/${tour}_matches_${year}.csv`;
    try{
      const text=await fetchText(url);
      for(const row of parseCsv(text))all.push({...row,_tour:tour,_year:year});
      process.stderr.write(`loaded ${tour} ${year}\n`);
    }catch(e){process.stderr.write(`skip ${tour} ${year}: ${e.message}\n`);}
  }
}
all.sort((a,b)=>dateKey(a).localeCompare(dateKey(b))||eventKey(a,a._tour).localeCompare(eventKey(b,b._tour))||String(a.match_num||"").localeCompare(String(b.match_num||"")));

const stateByTour={atp:new State(),wta:new State()},evalRows=[];
let i=0;
while(i<all.length){
  const ekey=eventKey(all[i],all[i]._tour);let j=i;
  while(j<all.length&&eventKey(all[j],all[j]._tour)===ekey)j++;
  const event=all.slice(i,j),tour=event[0]._tour,state=stateByTour[tour];

  for(const row of event){
    const year=row._year;if(year<EVAL_START)continue;
    const score=scoreOutcome(row.score);if(!score)continue;
    const wi=idOf(row,"winner"),li=idOf(row,"loser");if(!wi||!li)continue;
    const surface=String(row.surface||"Hard").toLowerCase();
    if(!["hard","clay","grass"].includes(surface))continue;
    const wprof=state.profile(wi,row.winner_name,surface,tour),lprof=state.profile(li,row.loser_name,surface,tour);
    if(Math.min(wprof.historicalMatches,lprof.historicalMatches)<3)continue;
    const winnerFirst=orientation(row,tour);
    const p1=winnerFirst?wprof:lprof,p2=winnerFirst?lprof:wprof;
    const game={id:`wf|${tour}|${row.tourney_id}|${row.match_num}`,surface,bestOf:Number(row.best_of)||3,player1:p1,player2:p2};
    const proj=simulateTennisMatch(game,{simulations:SIMS},{seed:game.id,researchBacktest:true});
    const p1side=winnerFirst?"w":"l";
    const p2side=winnerFirst?"l":"w";
    const p1Rank=finite(row[winnerFirst?"winner_rank":"loser_rank"]),p2Rank=finite(row[winnerFirst?"loser_rank":"winner_rank"]);
    const p1Stats=statPack(row,p1side);
    evalRows.push({
      tour,year,surface,bestOf:Number(row.best_of)||3,event:row.tourney_name,round:row.round,
      p1Win:proj.match.pPlayer1Win,actualP1Win:winnerFirst?1:0,
      predTotalGames:proj.match.totalGames.mean,actualTotalGames:score.totalGames,
      predTotalSets:proj.match.totalSets.mean,actualTotalSets:score.totalSets,
      predP1Games:proj.playerMetrics[0].total_games_won.mean,actualP1Games:winnerFirst?score.winnerGames:score.loserGames,
      predP1Aces:proj.playerMetrics[0].aces.mean,actualP1Aces:finite(row[`${p1side}_ace`]),
      predP1Df:proj.playerMetrics[0].double_faults.mean,actualP1Df:finite(row[`${p1side}_df`]),
      predP1Bp:proj.playerMetrics[0].break_points_won.mean,actualP1Bp:actualBpWon(row,p1side),
      rankFavoriteCorrect:p1Rank!=null&&p2Rank!=null?(p1Rank<p2Rank)===(winnerFirst):null,
      p1History:p1.historicalMatches,p2History:p2.historicalMatches,
    });
  }
  // Strict PIT: update only after all predictions for this event were frozen.
  for(const row of event){
    const surface=String(row.surface||"Hard").toLowerCase();
    if(["hard","clay","grass"].includes(surface))state.update(row,surface);
  }
  i=j;
}

const byYear=Object.fromEntries([...new Set(evalRows.map(r=>r.year))].sort().map(y=>[y,summarize(evalRows.filter(r=>r.year===y))]));
const byTour=Object.fromEntries(["atp","wta"].map(t=>[t,summarize(evalRows.filter(r=>r.tour===t))]));
const bySurface=Object.fromEntries(["hard","clay","grass"].map(s=>[s,summarize(evalRows.filter(r=>r.surface===s))]));
const overall=summarize(evalRows);
const report={
  generatedAt:new Date().toISOString(),
  model:"TENNIS-FBIS-v1",
  mode:"strict-event-freeze historical walk-forward",
  simulationsPerMatch:SIMS,
  evaluationStartYear:EVAL_START,
  yearsRequested:YEARS,
  source:{
    name:"Jeff Sackmann / Tennis Abstract archive mirror",
    mirror:"Aneeshers/tennis-sackmann-archive",
    license:SOURCE_LICENSE,
    productionDependency:false,
    permittedUse:"research/backtest only",
  },
  integrity:{
    futureDataUsed:false,
    sameEventResultsUsedForPredictions:false,
    eventStateFreeze:true,
    minimumPriorMatches:3,
    retirementsWalkoversAbandonedExcluded:true,
    matchTiebreakScoresExcluded:true,
    orientationRandomizedDeterministically:true,
  },
  limitations:{
    historicalSportsbookLines:false,
    historicalPrizePicksLines:false,
    roiClvValidated:false,
    surfaceSpeedAltitudeInjury:false,
    note:"This validates predictive calibration/accuracy only. It cannot authorize wagering without independent market-line/CLV evidence and a production-licensed historical source.",
  },
  overall,byTour,bySurface,byYear,
  sample:{evaluated:evalRows.length,loaded:all.length},
};

await fs.mkdir(path.dirname(OUT),{recursive:true});
await fs.writeFile(OUT,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
