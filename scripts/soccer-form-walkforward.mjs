#!/usr/bin/env node
import fs from "node:fs";
import { projectSoccerFromHistory, SOCCER_LEAGUES } from "../functions/lib/soccerFbisV1.js";

const EURO=new Set(["eng.1","esp.1","ger.1","ita.1","fra.1"]);
const ranges=(league)=>EURO.has(league)
  ? ["2023-08-01","2026-10-01"]
  : ["2023-02-01","2026-10-01"];
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
function tm(c){return{espnId:String(c?.team?.id||""),name:c?.team?.displayName||"",abbr:c?.team?.abbreviation||""};}
function months(start,end){
  const a=new Date(start+"T12:00:00Z"),b=new Date(end+"T12:00:00Z"),out=[];let y=a.getUTCFullYear(),m=a.getUTCMonth()+1;
  while(y<b.getUTCFullYear()||(y===b.getUTCFullYear()&&m<=b.getUTCMonth()+1)){
    out.push(String(y)+String(m).padStart(2,"0"));if(m===12){y++;m=1}else m++;
  }
  return out;
}
async function load(league,[start,end]){
  const events=[];
  for(const dates of months(start,end)){
    const u=`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${dates}&limit=1000`;
    const r=await fetch(u,{headers:{"user-agent":"FBIS-Soccer-WF/2.0",accept:"application/json"}});
    if(!r.ok)throw new Error(`${league} ${dates} ${r.status}`);
    const j=await r.json();events.push(...(j.events||[]));
  }
  const uniq=[...new Map(events.map(x=>[String(x.id),x])).values()];
  return uniq.flatMap(ev=>{
    const c=ev.competitions?.[0],xs=c?.competitors||[],h=xs.find(x=>x.homeAway==="home"),a=xs.find(x=>x.homeAway==="away"),hs=finite(h?.score),as=finite(a?.score);
    const date=String(ev.date||"").slice(0,10);
    if(!h||!a||!(ev.status?.type?.completed===true||c?.status?.type?.completed===true)||hs==null||as==null||date<start||date>end)return[];
    return[{id:String(ev.id),eventId:String(ev.id),league,start:ev.date,date,home:tm(h),away:tm(a),homeScore:hs,awayScore:as,neutralSite:Boolean(c?.neutralSite)}];
  }).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
}
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const rmse=xs=>xs.length?Math.sqrt(xs.reduce((s,x)=>s+x*x,0)/xs.length):null;
function argmax(p){return ["H","D","A"].sort((a,b)=>Number(p[b])-Number(p[a]))[0];}
function brier3(p,o){return(["H","D","A"].reduce((s,k)=>s+(Number(p[k])-(k===o?1:0))**2,0))/3;}
function binaryBrier(p,y){return(Number(p)-(y?1:0))**2;}
function calibration(rows){
  const obs=[];
  for(const r of rows){
    obs.push([r.pHome,r.outcome==="H"],[r.pDraw,r.outcome==="D"],[r.pAway,r.outcome==="A"]);
  }
  const bins=[];
  for(let lo=0;lo<1;lo+=0.1){
    const hi=lo+0.1, xs=obs.filter(([p])=>p>=lo&&(p<hi||(hi>=1&&p<=1)));
    if(!xs.length)continue;
    bins.push({lo:Number(lo.toFixed(1)),hi:Number(hi.toFixed(1)),n:xs.length,meanPrediction:mean(xs.map(x=>x[0])),observedRate:mean(xs.map(x=>x[1]?1:0))});
  }
  const ece=obs.length?bins.reduce((s,b)=>s+(b.n/obs.length)*Math.abs(b.meanPrediction-b.observedRate),0):null;
  return{ece,bins};
}
const rows=[];
const leagueLoad={};
for(const league of SOCCER_LEAGUES){
  const games=await load(league,ranges(league));
  leagueLoad[league]=games.length;
  console.log(`${league} games=${games.length}`);
  const seen=[];
  for(const g of games){
    const p=projectSoccerFromHistory(g,seen);
    if(p.ok&&seen.length>=60){
      const am=g.homeScore-g.awayScore,at=g.homeScore+g.awayScore,outcome=am>0?"H":am<0?"A":"D";
      const probs={H:p.pHomeWin,D:p.pDraw,A:p.pAwayWin};
      const pick=argmax(probs);
      const over25=at>2.5;
      const btts=g.homeScore>0&&g.awayScore>0;
      rows.push({
        league,id:g.id,start:g.start,homeTeam:g.home.name,awayTeam:g.away.name,
        projHome:p.home,projAway:p.away,pHome:p.pHomeWin,pDraw:p.pDraw,pAway:p.pAwayWin,
        pOver25:p.totals["2.5"].over,pBttsYes:p.pBttsYes,
        actualHome:g.homeScore,actualAway:g.awayScore,
        homeAbs:Math.abs(p.home-g.homeScore),awayAbs:Math.abs(p.away-g.awayScore),
        marginError:p.margin-am,totalError:p.total-at,
        marginAbs:Math.abs(p.margin-am),totalAbs:Math.abs(p.total-at),
        outcome,outcomeCorrect:pick===outcome,
        brier:brier3(probs,outcome),logLoss:-Math.log(Math.max(1e-12,probs[outcome])),
        over25Brier:binaryBrier(p.totals["2.5"].over,over25),
        bttsBrier:binaryBrier(p.pBttsYes,btts),
        uncertainty:p.uncertainty?.level||null,
        historyMatches:p.provenance?.historyMatches||0,
      });
    }
    seen.push(g);
  }
}
function metrics(r){
  return{
    n:r.length,
    homeGoalMae:mean(r.map(x=>x.homeAbs)),
    awayGoalMae:mean(r.map(x=>x.awayAbs)),
    marginMae:mean(r.map(x=>x.marginAbs)),
    marginBias:mean(r.map(x=>x.marginError)),
    marginRmse:rmse(r.map(x=>x.marginError)),
    totalMae:mean(r.map(x=>x.totalAbs)),
    totalBias:mean(r.map(x=>x.totalError)),
    totalRmse:rmse(r.map(x=>x.totalError)),
    threeWayAccuracy:r.length?r.filter(x=>x.outcomeCorrect).length/r.length:null,
    brier:mean(r.map(x=>x.brier)),
    logLoss:mean(r.map(x=>x.logLoss)),
    over25Brier:mean(r.map(x=>x.over25Brier)),
    bttsBrier:mean(r.map(x=>x.bttsBrier)),
    calibration:calibration(r),
  };
}
const overall=metrics(rows);
const report={
  generatedAt:new Date().toISOString(),
  modelId:"SOCCER-FBIS-v1",
  modelVersion:"research-v2-dixon-coles",
  validation:"TRUE_EXPANDING_WALK_FORWARD",
  source:"ESPN scoreboard historical results",
  leakagePolicy:"each prediction uses only rows strictly before kickoff date",
  loadedGames:leagueLoad,
  ...overall,
  leagues:Object.fromEntries(SOCCER_LEAGUES.map(l=>[l,metrics(rows.filter(x=>x.league===l))])),
  uncertainty:Object.fromEntries(["LOW","MEDIUM","HIGH"].map(k=>[k,metrics(rows.filter(x=>x.uncertainty===k))])),
  governance:{
    maturity:"RESEARCH",
    canQualify:false,
    canAuthorize:false,
    marketValidationRequired:true,
    prospectiveValidationRequired:true,
    requirements:[
      "point-in-time walk-forward validation",
      "league-level sample and calibration review",
      "no-vig market benchmark",
      "edge-bucket stability",
      "prospective shadow evidence",
      "operator approval before wager authority"
    ]
  }
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/soccer-form-walkforward-report.json",JSON.stringify(report,null,2));
fs.writeFileSync("artifacts/soccer-form-walkforward-rows.jsonl",rows.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
if(rows.length<500)process.exitCode=3;
