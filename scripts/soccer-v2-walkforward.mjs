#!/usr/bin/env node
import fs from "node:fs";
import { projectSoccerFromHistory, soccerConfidencePick, SOCCER_LEAGUES } from "../functions/lib/soccerFbisV1.js";
import { projectSoccerV2, SOCCER_FBIS_V2_ID, SOCCER_FBIS_V2_VERSION } from "../functions/lib/soccerFbisV2.js";

const EURO=new Set(["eng.1","esp.1","ger.1","ita.1","fra.1"]);
const ranges=(league)=>EURO.has(league)?["2023-08-01","2026-10-01"]:["2023-02-01","2026-10-01"];
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
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
    let r=null,lastErr=null;
    for(let attempt=1;attempt<=3;attempt++){
      try{
        r=await fetch(u,{headers:{"user-agent":"FBIS-Soccer-V2-WF/1.0",accept:"application/json"},signal:AbortSignal.timeout(12000)});
        if(r.ok)break;
        lastErr=new Error(`${league} ${dates} HTTP ${r.status}`);
      }catch(err){lastErr=err;}
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1000));
    }
    if(!r?.ok)throw lastErr||new Error(`${league} ${dates} fetch failed`);
    const j=await r.json(); events.push(...(j.events||[]));
  }
  const uniq=[...new Map(events.map(x=>[String(x.id),x])).values()];
  return uniq.flatMap(ev=>{
    const c=ev.competitions?.[0],xs=c?.competitors||[];
    const h=xs.find(x=>x.homeAway==="home"),a=xs.find(x=>x.homeAway==="away");
    const hs=finite(h?.score),as=finite(a?.score),date=String(ev.date||"").slice(0,10);
    const done=ev.status?.type?.completed===true||c?.status?.type?.completed===true;
    if(!h||!a||!done||hs==null||as==null||date<start||date>end)return[];
    return[{id:String(ev.id),eventId:String(ev.id),league,start:ev.date,date,home:tm(h),away:tm(a),homeScore:hs,awayScore:as,neutralSite:Boolean(c?.neutralSite)}];
  }).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
}
function outcome(g){return g.homeScore>g.awayScore?"H":g.homeScore<g.awayScore?"A":"D";}
function argmax(p){return ["H","D","A"].sort((a,b)=>Number(p[b])-Number(p[a]))[0];}
function brier(p,o){return(["H","D","A"].reduce((s,k)=>s+(Number(p[k])-(k===o?1:0))**2,0))/3;}
function cal(rows,prefix){
  const obs=[];
  for(const r of rows)obs.push([r[`${prefix}Home`],r.outcome==="H"],[r[`${prefix}Draw`],r.outcome==="D"],[r[`${prefix}Away`],r.outcome==="A"]);
  let e=0;
  for(let lo=0;lo<1;lo+=0.1){
    const hi=lo+0.1,xs=obs.filter(([p])=>p>=lo&&(p<hi||(hi>=1&&p<=1)));
    if(!xs.length)continue;
    e+=(xs.length/obs.length)*Math.abs(mean(xs.map(x=>x[0]))-mean(xs.map(x=>x[1]?1:0)));
  }
  return e;
}
function metrics(rows,prefix){
  const picks=rows.map(r=>argmax({H:r[`${prefix}Home`],D:r[`${prefix}Draw`],A:r[`${prefix}Away`]}));
  return{
    n:rows.length,
    accuracy:rows.length?mean(rows.map((r,i)=>picks[i]===r.outcome?1:0)):null,
    brier:mean(rows.map(r=>brier({H:r[`${prefix}Home`],D:r[`${prefix}Draw`],A:r[`${prefix}Away`]},r.outcome))),
    logLoss:mean(rows.map(r=>-Math.log(Math.max(1e-12,r[`${prefix}${r.outcome==="H"?"Home":r.outcome==="D"?"Draw":"Away"}`])))),
    ece:cal(rows,prefix),
  };
}
const rows=[];
const loaded={};
for(const league of SOCCER_LEAGUES){
  const games=await load(league,ranges(league)); loaded[league]=games.length;
  console.log(`${league} games=${games.length}`);
  const seen=[];
  for(const g of games){
    const v1=projectSoccerFromHistory(g,seen);
    const v2=projectSoccerV2(g,seen);
    if(v1.ok&&v2.ok&&seen.length>=60){
      const o=outcome(g);
      const conf=soccerConfidencePick(g,v2);
      rows.push({
        league:g.league,id:g.id,start:g.start,outcome:o,
        v1Home:v1.pHomeWin,v1Draw:v1.pDraw,v1Away:v1.pAwayWin,
        v2Home:v2.pHomeWin,v2Draw:v2.pDraw,v2Away:v2.pAwayWin,
        challengerActive:Boolean(v2.challenger?.active),
        v1Weight:v2.ensemble?.v1Weight??1,
        advancedCoverage:v2.uncertainty?.advancedCoverage??0,
        stars:conf.stars,confidenceScore:conf.score,
        confidenceCorrect:(conf.side==="HOME"&&o==="H")||(conf.side==="DRAW"&&o==="D")||(conf.side==="AWAY"&&o==="A"),
      });
    }
    seen.push(g);
  }
}
const v1=metrics(rows,"v1");
const v2=metrics(rows,"v2");
const report={
  generatedAt:new Date().toISOString(),
  modelId:SOCCER_FBIS_V2_ID,
  modelVersion:SOCCER_FBIS_V2_VERSION,
  validation:"TRUE_EXPANDING_WALK_FORWARD_HEAD_TO_HEAD",
  source:"ESPN scoreboard historical results",
  leakagePolicy:"each prediction and online model update uses only matches strictly before target kickoff",
  loadedGames:loaded,
  v1,
  v2,
  deltas:{
    accuracy:v2.accuracy-v1.accuracy,
    brier:v2.brier-v1.brier,
    logLoss:v2.logLoss-v1.logLoss,
    ece:v2.ece-v1.ece,
  },
  challengerActive:rows.filter(r=>r.challengerActive).length,
  starBuckets:Object.fromEntries([1,2,3,4,5].map(star=>{
    const xs=rows.filter(r=>r.stars===star);
    return[String(star),{n:xs.length,hitRate:xs.length?mean(xs.map(x=>x.confidenceCorrect?1:0)):null}];
  })),
  leagues:Object.fromEntries(SOCCER_LEAGUES.map(l=>{
    const xs=rows.filter(r=>r.league===l);
    return[l,{v1:metrics(xs,"v1"),v2:metrics(xs,"v2")}];
  })),
  promotion:{
    samplePass:rows.length>=1000,
    beatsV1Brier:v2.brier<v1.brier,
    beatsV1LogLoss:v2.logLoss<v1.logLoss,
    nonDegradingAccuracy:v2.accuracy>=v1.accuracy-0.0025,
    decision:(rows.length>=1000&&v2.brier<v1.brier&&v2.logLoss<v1.logLoss&&v2.accuracy>=v1.accuracy-0.0025)?"HISTORICAL_EVIDENCE_PASS":"RESEARCH",
    canQualify:false,
    canAuthorize:false,
  }
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/soccer-v2-walkforward-report.json",JSON.stringify(report,null,2));
fs.writeFileSync("artifacts/soccer-v2-walkforward-rows.jsonl",rows.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
if(rows.length<500)process.exitCode=3;
