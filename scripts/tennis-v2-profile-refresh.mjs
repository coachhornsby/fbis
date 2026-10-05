#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { TennisDeepState } from "../functions/lib/tennisTwoSidedV11.js";
import { deriveCourtSpeedIndex } from "../functions/lib/tennisContextV2.js";

const YEARS=String(process.env.TENNIS_PROFILE_YEARS||"2024,2025,2026").split(",").map(Number).filter(Number.isFinite);
const OUT=process.env.TENNIS_PROFILE_SQL||"artifacts/tennis-v2-current-profiles.sql";
const SUMMARY=process.env.TENNIS_PROFILE_SUMMARY||"artifacts/tennis-v2-current-profiles-summary.json";
const MIRROR="https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";
const cutoff=process.env.TENNIS_PROFILE_CUTOFF||new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()).replaceAll("-","");
const sourceAsOf=`${cutoff.slice(0,4)}-${cutoff.slice(4,6)}-${cutoff.slice(6,8)}T00:00:00-05:00`;

const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const clean=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const surfaceKey=s=>{s=String(s||"hard").toLowerCase();return s.includes("clay")?"clay":s.includes("grass")?"grass":"hard"};
const q=v=>v==null?"NULL":`'${String(v).replaceAll("'","''")}'`;
const n=v=>Number.isFinite(Number(v))?String(Number(v)):"NULL";

function parseCsv(text){
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;}
    else{if(ch==='"')quoted=true;else if(ch===","){row.push(field);field="";}else if(ch==="\n"){row.push(field);rows.push(row);row=[];field="";}else if(ch!=="\r")field+=ch;}
  }
  if(field||row.length){row.push(field);rows.push(row)}
  const h=rows.shift()||[];
  return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??""])));
}
async function fetchText(url){
  const r=await fetch(url,{headers:{"user-agent":"FBIS tennis v2 current-profile research"}});
  if(!r.ok)throw new Error(`${r.status} ${url}`);
  return r.text();
}
function dateIso(raw){
  const s=String(raw||"");
  return /^\d{8}$/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:null;
}
function daysBetween(a,b){
  const x=Date.parse(`${a}T12:00:00Z`),y=Date.parse(`${b}T12:00:00Z`);
  return Number.isFinite(x)&&Number.isFinite(y)?Math.floor((y-x)/86400000):null;
}
function parseScore(score){
  const s=String(score||"").trim();
  const sets=s.split(/\s+/).map(x=>x.match(/^(\d+)-(\d+)(?:\([^)]*\))?$/)).filter(Boolean).map(m=>[Number(m[1]),Number(m[2])]).filter(x=>x[0]<=7&&x[1]<=7);
  if(!sets.length)return {games:null,sets:null};
  return {games:sets.reduce((z,x)=>z+x[0]+x[1],0),sets:sets.length};
}
function tournamentSide(row,side){
  const svpt=finite(row[`${side}_svpt`]),ace=finite(row[`${side}_ace`]),firstWon=finite(row[`${side}_1stWon`]),secondWon=finite(row[`${side}_2ndWon`]);
  if([svpt,ace,firstWon,secondWon].some(x=>x==null)||svpt<=0)return null;
  return {aceRate:ace/svpt,servePointWin:(firstWon+secondWon)/svpt,holdPct:null};
}
function styleScores(profile,tour){
  const p=tour==="wta"?{ace:.045,first:.66,ret:.41}:{ace:.075,first:.72,ret:.36};
  return {
    serveStyleScore:clamp(((profile.aceRate-p.ace)/.05+(profile.firstServeWin-p.first)/.09)/2,-2,2),
    returnStyleScore:clamp((profile.returnPointWin-p.ret)/.07,-2,2),
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
all.sort((a,b)=>String(a.tourney_date).localeCompare(String(b.tourney_date))||String(a.match_num||"").localeCompare(String(b.match_num||"")));

const states={atp:new TennisDeepState("atp"),wta:new TennisDeepState("wta")};
const meta={atp:new Map(),wta:new Map()};
const tournaments=new Map();

function touch(tour,id,name,row,surface,outcome,retired=false){
  if(!id)return;
  const m=meta[tour];
  if(!m.has(id))m.set(id,{id,name:name||id,lastDate:null,lastSurface:null,lastTournament:null,lastRetirement:null,matches:[]});
  const x=m.get(id);
  if(name)x.name=name;
  const d=dateIso(row.tourney_date);
  if(d){
    x.lastDate=d;x.lastSurface=surface;x.lastTournament=row.tourney_name||null;
    if(retired)x.lastRetirement=d;
    if(outcome.games!=null)x.matches.push({date:d,games:outcome.games,sets:outcome.sets});
  }
}

for(const row of all){
  const date=String(row.tourney_date||"");
  if(!/^\d{8}$/.test(date)||date>=cutoff)continue;
  const tour=row._tour,surface=surfaceKey(row.surface),state=states[tour];
  const wid=String(row.winner_id||row.winner_name||"").trim(),lid=String(row.loser_id||row.loser_name||"").trim();
  const outcome=parseScore(row.score);
  const retired=/RET|DEF|ABD/i.test(String(row.score||""));
  touch(tour,wid,row.winner_name,row,surface,outcome,false);
  touch(tour,lid,row.loser_name,row,surface,outcome,retired);
  state.update(row,surface);

  const tk=`${tour}|${row._year}|${clean(row.tourney_name)}`;
  if(!tournaments.has(tk))tournaments.set(tk,{tour,year:row._year,name:row.tourney_name||"",surface,rows:[]});
  const t=tournaments.get(tk);
  for(const side of ["w","l"]){const sr=tournamentSide(row,side);if(sr)t.rows.push(sr)}
}

const cutoffIso=dateIso(cutoff);
const profileRows=[];
for(const tour of ["atp","wta"]){
  for(const x of meta[tour].values()){
    const recent=x.matches.filter(m=>daysBetween(m.date,cutoffIso)!=null&&daysBetween(m.date,cutoffIso)>=0&&daysBetween(m.date,cutoffIso)<=7);
    const g3=recent.filter(m=>daysBetween(m.date,cutoffIso)<=3).reduce((s,m)=>s+m.games,0);
    const g7=recent.reduce((s,m)=>s+m.games,0);
    const s3=recent.filter(m=>daysBetween(m.date,cutoffIso)<=3).reduce((s,m)=>s+(m.sets||0),0);
    const s7=recent.reduce((s,m)=>s+(m.sets||0),0);
    const daysRet=x.lastRetirement?daysBetween(x.lastRetirement,cutoffIso):null;
    for(const surface of ["hard","clay","grass"]){
      const p=states[tour].profile(x.id,x.name,surface);
      if((p.historyMatches||0)<3)continue;
      const styles=styleScores(p,tour);
      profileRows.push({
        tour,playerKey:clean(x.name),playerId:String(x.id),playerName:x.name,surface,
        profile:{...p,...styles},
        lastDate:x.lastDate,lastSurface:x.lastSurface,lastTournament:x.lastTournament,
        gamesLast3Days:g3,gamesLast7Days:g7,setsLast3Days:s3,setsLast7Days:s7,
        daysSinceRetirementOrMto:daysRet,
      });
    }
  }
}
const speedRows=[];
for(const t of tournaments.values()){
  if(t.year!==Math.max(...YEARS)||t.rows.length<10)continue;
  const csi=deriveCourtSpeedIndex(t.rows,{tour:t.tour});
  if(csi==null)continue;
  speedRows.push({...t,courtSpeedIndex:csi,sampleSides:t.rows.length,tournamentKey:clean(t.name)});
}

const now=new Date().toISOString();
let sql="DELETE FROM tennis_player_profiles_current;\nDELETE FROM tennis_tournament_speed_current;\n";
for(const r of profileRows){
  sql+=`INSERT INTO tennis_player_profiles_current(tour,player_key,player_id,player_name,surface,profile_json,last_match_date,last_surface,last_tournament,games_last_3_days,games_last_7_days,sets_last_3_days,sets_last_7_days,days_since_retirement_or_mto,source,source_license,source_as_of,production_dependency,updated_at) VALUES(${q(r.tour)},${q(r.playerKey)},${q(r.playerId)},${q(r.playerName)},${q(r.surface)},${q(JSON.stringify(r.profile))},${q(r.lastDate)},${q(r.lastSurface)},${q(r.lastTournament)},${n(r.gamesLast3Days)},${n(r.gamesLast7Days)},${n(r.setsLast3Days)},${n(r.setsLast7Days)},${n(r.daysSinceRetirementOrMto)},'SACKMANN_TENNIS_ABSTRACT_RESEARCH','CC BY-NC-SA 4.0',${q(sourceAsOf)},0,${q(now)});\n`;
}
for(const r of speedRows){
  sql+=`INSERT INTO tennis_tournament_speed_current(tour,tournament_key,tournament_name,season,surface,court_speed_index,sample_sides,source,source_as_of,production_dependency,updated_at) VALUES(${q(r.tour)},${q(r.tournamentKey)},${q(r.name)},${n(r.year)},${q(r.surface)},${n(r.courtSpeedIndex)},${n(r.sampleSides)},'SACKMANN_TENNIS_ABSTRACT_RESEARCH',${q(sourceAsOf)},0,${q(now)});\n`;
}

await fs.mkdir(path.dirname(OUT),{recursive:true});
await fs.writeFile(OUT,sql);
const summary={
  generatedAt:now,cutoffCT:cutoff,
  source:{name:"Jeff Sackmann / Tennis Abstract archive mirror",license:"CC BY-NC-SA 4.0",productionDependency:false,permittedUse:"research/backtest/private research only"},
  profiles:profileRows.length,players:{atp:meta.atp.size,wta:meta.wta.size},speedRows:speedRows.length,
  integrity:{sameDayExcluded:true,futureRowsExcluded:true,cutoff:sourceAsOf},
  missingByDesign:["travelKm7Days","timeZonesCrossed7Days","minutesLast3Days","minutesLast7Days","injuryStatus","recentServeSpeedDeltaKph","indoor","altitudeM"],
};
await fs.writeFile(SUMMARY,JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
