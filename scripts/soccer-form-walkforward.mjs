#!/usr/bin/env node
import fs from "node:fs";
import { projectSoccerForm, SOCCER_LEAGUES } from "../functions/lib/soccerFbisV1.js";
const EURO=new Set(["eng.1","esp.1","ger.1","ita.1","fra.1"]);
const ranges=(league)=>EURO.has(league)
 ? {prior:["2024-08-01","2025-06-10"],target:["2025-08-01","2026-06-10"]}
 : {prior:["2024-02-15","2024-12-15"],target:["2025-02-15","2025-12-15"]};
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
function tm(c){return{id:String(c?.team?.id||""),name:c?.team?.displayName||"",abbr:c?.team?.abbreviation||""};}
function months(start,end){
 const a=new Date(start+"T12:00:00Z"),b=new Date(end+"T12:00:00Z"),out=[];let y=a.getUTCFullYear(),m=a.getUTCMonth()+1;
 while(y<b.getUTCFullYear()||(y===b.getUTCFullYear()&&m<=b.getUTCMonth()+1)){out.push(String(y)+String(m).padStart(2,"0"));if(m===12){y++;m=1}else m++;}
 return out;
}
async function load(league,[start,end]){
 const events=[];
 for(const dates of months(start,end)){
  const u=`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${dates}&limit=1000`;
  const r=await fetch(u,{headers:{"user-agent":"FBIS-Soccer-WF/1.0",accept:"application/json"}});if(!r.ok)throw new Error(`${league} ${dates} ${r.status}`);
  const j=await r.json();events.push(...(j.events||[]));
 }
 const uniq=[...new Map(events.map(x=>[String(x.id),x])).values()];
 return uniq.flatMap(ev=>{const c=ev.competitions?.[0],xs=c?.competitors||[],h=xs.find(x=>x.homeAway==="home"),a=xs.find(x=>x.homeAway==="away"),hs=finite(h?.score),as=finite(a?.score);
  if(!h||!a||!(ev.status?.type?.completed===true||c?.status?.type?.completed===true)||hs==null||as==null)return[];
  return[{id:String(ev.id),start:ev.date,home:tm(h),away:tm(a),homeScore:hs,awayScore:as,neutralSite:Boolean(c?.neutralSite)}];});
}
function agg(games){const m=new Map();for(const g of games)for(const [t,pf,pa] of [[g.home,g.homeScore,g.awayScore],[g.away,g.awayScore,g.homeScore]]){const r=m.get(t.id)||{games:0,pointsFor:0,pointsAgainst:0};r.games++;r.pointsFor+=pf;r.pointsAgainst+=pa;m.set(t.id,r);}return m;}
const rows=[];
for(const league of SOCCER_LEAGUES){
 const rg=ranges(league),prior=await load(league,rg.prior),target=(await load(league,rg.target)).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 console.log(`${league} prior=${prior.length} target=${target.length}`);
 const pmap=agg(prior),seen=[];
 for(const g of target){
  const cur=agg(seen),p=projectSoccerForm(g,{homePrior:pmap.get(g.home.id),awayPrior:pmap.get(g.away.id),homeCurrent:cur.get(g.home.id),awayCurrent:cur.get(g.away.id)});
  if(p.ok){const am=g.homeScore-g.awayScore,at=g.homeScore+g.awayScore,outcome=am>0?"H":am<0?"A":"D",pick=p.pHomeWin>=p.pAwayWin&&p.pHomeWin>=p.pDraw?"H":p.pAwayWin>=p.pDraw?"A":"D";
   const probs={H:p.pHomeWin,D:p.pDraw,A:p.pAwayWin};\n   rows.push({league,id:g.id,start:g.start,projHome:p.home,projAway:p.away,pHome:p.pHomeWin,pDraw:p.pDraw,pAway:p.pAwayWin,actualHome:g.homeScore,actualAway:g.awayScore,marginAbs:Math.abs(p.margin-am),totalAbs:Math.abs(p.total-at),outcomeCorrect:pick===outcome,brier:(["H","D","A"].reduce((s,k)=>s+(probs[k]-(k===outcome?1:0))**2,0))/3,logLoss:-Math.log(Math.max(1e-12,probs[outcome]))});}
  seen.push(g);
 }
}
const mean=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
const report={generatedAt:new Date().toISOString(),modelId:"SOCCER-FBIS-v1",n:rows.length,marginMae:mean(rows.map(x=>x.marginAbs)),totalMae:mean(rows.map(x=>x.totalAbs)),threeWayAccuracy:rows.length?rows.filter(x=>x.outcomeCorrect).length/rows.length:null,
 leagues:Object.fromEntries(SOCCER_LEAGUES.map(l=>{const r=rows.filter(x=>x.league===l);return[l,{n:r.length,marginMae:mean(r.map(x=>x.marginAbs)),totalMae:mean(r.map(x=>x.totalAbs)),threeWayAccuracy:r.length?r.filter(x=>x.outcomeCorrect).length/r.length:null}]})),
 governance:{maturity:"RESEARCH",canQualify:false,canAuthorize:false,marketValidationRequired:true}};
fs.mkdirSync("artifacts",{recursive:true});fs.writeFileSync("artifacts/soccer-form-walkforward-report.json",JSON.stringify(report,null,2));fs.writeFileSync("artifacts/soccer-form-walkforward-rows.jsonl",rows.map(x=>JSON.stringify(x)).join("\n")+"\n");console.log(JSON.stringify(report,null,2));
