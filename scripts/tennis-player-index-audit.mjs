#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { TennisDeepState } from "../functions/lib/tennisTwoSidedV11.js";
import { simulateTennisV2 } from "../functions/lib/tennisFbisV2.js";
import { auditTennisCsv,parseTennisCsv,TENNIS_THIN_SURFACE_MATCHES } from "../functions/lib/tennisPlayerDataIntegrity.js";

const OUT=process.env.TENNIS_PLAYER_AUDIT_OUT||"artifacts/tennis-player-index-audit.json";
const CUTOFF=String(process.env.TENNIS_PLAYER_AUDIT_CUTOFF||"20261007").replaceAll("-","");
const RANK_DATE=process.env.TENNIS_PLAYER_RANK_DATE||"2026-10-05";
const MIRROR=process.env.TENNIS_SACKMANN_MIRROR||"https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";
const TML=process.env.TENNIS_TML_BASE||"https://stats.tennismylife.org/data";
const RANK_API=process.env.TENNIS_RANK_API||`https://stats.tennismylife.org/api/ranking?date=${RANK_DATE}`;
const ATP_YEARS=Array.from({length:12},(_,i)=>2015+i);
const CH_YEARS=Array.from({length:7},(_,i)=>2020+i);
const acceptanceNames=["Arthur Gea","Jaime Faria","Roman Safiullin","Rinky Hijikata","Coleman Wong","Quentin Halys","Yibing Wu","Michael Zheng"];
const matchups=[
  {a:"Arthur Gea",b:"Jaime Faria",market:"A_STRAIGHT",price:134},
  {a:"Roman Safiullin",b:"Rinky Hijikata",market:"A_STRAIGHT",price:-114},
  {a:"Coleman Wong",b:"Quentin Halys",market:"A_ML",price:109},
  {a:"Yibing Wu",b:"Michael Zheng",market:"A_ML",price:-123},
];
const clean=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const iso=s=>/^\d{8}$/.test(String(s||""))?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:null;
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
async function getText(url){const r=await fetch(url,{headers:{"user-agent":"FBIS tennis player index integrity audit"}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.text();}
async function getJson(url){const r=await fetch(url,{headers:{"user-agent":"FBIS tennis player index integrity audit"}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.json();}
const sourceAudit=[],rows=[];
async function load(year,sourceClass,url,source){
  try{
    const txt=await getText(url),a={...auditTennisCsv(txt,{source,sourceClass,year}),url};
    sourceAudit.push(a);if(!a.safe)return;
    for(const r of parseTennisCsv(txt).rows){
      if(!/^\d{8}$/.test(String(r.tourney_date||""))||String(r.tourney_date)>=CUTOFF)continue;
      rows.push({...r,_year:year,_sourceClass:sourceClass,_source:source});
    }
  }catch(e){sourceAudit.push({year,sourceClass,source,url,bytes:0,rows:0,serveCoverage:0,distinctPlayers:0,levels:[],safe:false,reasons:["fetch_failed"],error:e.message});}
}
for(const y of ATP_YEARS)await load(y,"ATP_TOUR",`${MIRROR}/atp/atp_matches_${y}.csv`,"SACKMANN_ARCHIVE_RESEARCH");
for(const y of CH_YEARS)await load(y,"ATP_CHALLENGER",`${TML}/${y}_challenger.csv`,"TML_RESEARCH_ONLY");
const unsafeRequired=sourceAudit.filter(x=>(x.year<=2025)&&(["ATP_TOUR","ATP_CHALLENGER"].includes(x.sourceClass))&&!x.safe);
if(unsafeRequired.length)throw new Error("required source audit failed: "+unsafeRequired.map(x=>x.sourceClass+":"+x.year+":"+x.reasons.join("|")).join(","));

rows.sort((a,b)=>String(a.tourney_date).localeCompare(String(b.tourney_date))||String(a.match_num||"").localeCompare(String(b.match_num||"")));
const state=new TennisDeepState("atp"),meta=new Map();
function touch(id,name,row,side){
  if(!id)return;const k=String(id);
  if(!meta.has(k))meta.set(k,{id:k,name:name||k,lastDate:null,lastRank:null,sources:new Set(),matches:0});
  const m=meta.get(k);if(name)m.name=name;m.lastDate=iso(String(row.tourney_date));m.lastRank=finite(row[side+"_rank"]);m.sources.add(row._sourceClass);m.matches++;
}
for(const r of rows){
  const w=String(r.winner_id||r.winner_name||"").trim(),l=String(r.loser_id||r.loser_name||"").trim();
  touch(w,r.winner_name,r,"winner");touch(l,r.loser_name,r,"loser");state.update(r,r.surface);
}
const byName=new Map([...meta.values()].map(m=>[clean(m.name),m]));
function acceptance(name){
  const m=byName.get(clean(name));if(!m)return {name,resolved:false,profileType:"missing"};
  const p=state.profile(m.id,m.name,"hard");
  return {name,resolved:true,playerId:m.id,latestMatchDate:m.lastDate,latestRank:m.lastRank,overallElo:p.elo,hardElo:p.surfaceElo?.hard??null,
    hardMatches:p.surfaceMatches,hardServiceGames:p.surfaceServiceGames,servePointWinPct:p.servePointWin,returnPointWinPct:p.returnPointWin,
    aceRate:p.aceRate,doubleFaultRate:p.doubleFaultRate,profileType:"historical",thinSample:(p.surfaceMatches||0)<TENNIS_THIN_SURFACE_MATCHES,
    sourceClasses:[...m.sources].sort()};
}
const acceptancePlayers=acceptanceNames.map(acceptance);

const players=[...meta.values()];
const indexStats={
  totalIndexedPlayers:players.length,
  atpOnly:players.filter(x=>x.sources.has("ATP_TOUR")&&!x.sources.has("ATP_CHALLENGER")).length,
  challengerConnected:players.filter(x=>x.sources.has("ATP_CHALLENGER")).length,
  hardProfiles:players.filter(x=>state.profile(x.id,x.name,"hard").surfaceMatches>0).length,
  clayProfiles:players.filter(x=>state.profile(x.id,x.name,"clay").surfaceMatches>0).length,
  grassProfiles:players.filter(x=>state.profile(x.id,x.name,"grass").surfaceMatches>0).length,
  usableSurfaceElo:players.filter(x=>["hard","clay","grass"].some(s=>state.profile(x.id,x.name,s).surfaceMatches>0&&Number.isFinite(state.profile(x.id,x.name,s).surfaceElo?.[s]))).length,
  hardThinSamples:players.filter(x=>state.profile(x.id,x.name,"hard").surfaceMatches<TENNIS_THIN_SURFACE_MATCHES).length,
  newestMatchDate:players.map(x=>x.lastDate).filter(Boolean).sort().at(-1)||null,
};

let rankings=[];
try{
 const r=await getJson(RANK_API);rankings=Array.isArray(r)?r:(r.rankings||r.data||[]);
}catch(e){process.stderr.write("ranking fetch failed: "+e.message+"\n");}
rankings=rankings.map(r=>({rank:finite(r.rank??r.position),name:r.name??r.player_name??r.player?.name,id:String(r.id??r.player_id??r.player?.id??"")})).filter(r=>r.rank&&r.name).sort((a,b)=>a.rank-b.rank);
function recencyDays(date){if(!date)return null;return Math.floor((Date.parse(RANK_DATE+"T12:00:00Z")-Date.parse(date+"T12:00:00Z"))/86400000)}
function bucketRank(rank){if(rank<=50)return"1-50";if(rank<=100)return"51-100";if(rank<=150)return"101-150";if(rank<=250)return"151-250";return"Challenger/beyond250";}
const sampleRanks=rankings.filter(r=>r.rank<=500);
const coverageRows=sampleRanks.map(r=>{
 const m=(r.id&&meta.get(r.id))||byName.get(clean(r.name));if(!m)return {...r,band:bucketRank(r.rank),resolution:"miss"};
 const p=state.profile(m.id,m.name,"hard"),days=recencyDays(m.lastDate);
 return {...r,band:bucketRank(r.rank),resolution:"historical",playerId:m.id,hardMatches:p.surfaceMatches,validSurfaceElo:Number.isFinite(p.surfaceElo?.hard),latestMatchDate:m.lastDate,recencyDays:days};
});
function summarizeCoverage(xs){
 const n=xs.length||1,h=xs.filter(x=>x.resolution==="historical"),miss=xs.filter(x=>x.resolution==="miss");
 const pct=k=>Number((k/(xs.length||1)).toFixed(4));
 return {n:xs.length,historicalResolutionRate:pct(h.length),liveFallbackRate:0,completeMissRate:pct(miss.length),
   hard20Rate:pct(h.filter(x=>(x.hardMatches||0)>=20).length),validSurfaceEloRate:pct(h.filter(x=>x.validSurfaceElo).length),
   recency:{days30:pct(h.filter(x=>x.recencyDays!=null&&x.recencyDays<=30).length),days90:pct(h.filter(x=>x.recencyDays>30&&x.recencyDays<=90).length),
   days180:pct(h.filter(x=>x.recencyDays>90&&x.recencyDays<=180).length),older180:pct(h.filter(x=>x.recencyDays>180).length)}};
}
const coverage={};
for(const b of ["1-50","51-100","101-150","151-250","Challenger/beyond250"])coverage[b]=summarizeCoverage(coverageRows.filter(x=>x.band===b));
coverage.top250=summarizeCoverage(coverageRows.filter(x=>x.rank<=250));

function breakEven(price){return price>0?100/(price+100):(-price)/((-price)+100)}
function fairAmerican(p){if(!(p>0&&p<1))return null;return p>=.5?-100*p/(1-p):100*(1-p)/p}
const projections=[];
for(const m of matchups){
 const ma=byName.get(clean(m.a)),mb=byName.get(clean(m.b));
 if(!ma||!mb){projections.push({...m,status:"NO VALID PROJECTION / INSUFFICIENT PLAYER DATA"});continue;}
 const a=state.profile(ma.id,ma.name,"hard"),b=state.profile(mb.id,mb.name,"hard");
 const p=simulateTennisV2({id:`shanghai|${m.a}|${m.b}`,tour:"atp",surface:"hard",bestOf:3,player1:a,player2:b,playerContexts:[{},{}]},{simulations:12000},{seed:`shanghai|${m.a}|${m.b}`});
 if(!p.ok){projections.push({...m,status:"NO VALID PROJECTION / INSUFFICIENT PLAYER DATA",integrity:p});continue;}
 const modelProb=m.market==="A_STRAIGHT"?p.match.pPlayer1StraightSets:p.match.pPlayer1Win;
 const be=breakEven(m.price);
 projections.push({...m,status:"RESEARCH_ONLY",playerA:{id:ma.id,source:[...ma.sources],hardMatches:a.surfaceMatches,hardElo:a.surfaceElo?.hard,thin:a.surfaceMatches<TENNIS_THIN_SURFACE_MATCHES},
   playerB:{id:mb.id,source:[...mb.sources],hardMatches:b.surfaceMatches,hardElo:b.surfaceElo?.hard,thin:b.surfaceMatches<TENNIS_THIN_SURFACE_MATCHES},
   matchWinA:p.match.pPlayer1Win,matchWinB:p.match.pPlayer2Win,straightA:p.match.pPlayer1StraightSets,straightB:p.match.pPlayer2StraightSets,decidingSet:p.match.pDecidingSet,
   sportsbookBreakEven:be,modelProbability:modelProb,rawProbabilityEdge:modelProb-be,theoreticalFairAmerican:fairAmerican(modelProb)});
}
const report={generatedAt:new Date().toISOString(),cutoff:CUTOFF,rankDate:RANK_DATE,governance:{researchOnly:true,canQualify:false,canAuthorizeWager:false,rightsNote:"TML Challenger input is research-only; commercial/production permission not established"},sourceAudit,indexStats,acceptancePlayers,coverage,coverageRows,projections};
await fs.mkdir(path.dirname(OUT),{recursive:true});await fs.writeFile(OUT,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({sourceAudit,indexStats,acceptancePlayers,coverage,projections},null,2));
