#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { TennisDeepState } from "../functions/lib/tennisTwoSidedV11.js";
import { auditTennisCsv, assertTennisCoverage, parseTennisCsv } from "../functions/lib/tennisPlayerDataIntegrity.js";

const years=v=>String(v).split(",").map(Number).filter(Number.isFinite);
const ATP_TOUR_YEARS=years(process.env.TENNIS_ATP_TOUR_YEARS||"2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025,2026");
const ATP_CHALLENGER_YEARS=years(process.env.TENNIS_ATP_CHALLENGER_YEARS||"2020,2021,2022,2023,2024,2025,2026");
const WTA_YEARS=years(process.env.TENNIS_WTA_YEARS||"2024,2025,2026");
const YEARS=[...new Set([...ATP_TOUR_YEARS,...WTA_YEARS])];
const OUT=process.env.TENNIS_PROFILE_SQL||"artifacts/tennis-v2-current-profiles.sql";
const SUMMARY=process.env.TENNIS_PROFILE_SUMMARY||"artifacts/tennis-v2-current-profiles-summary.json";
const MIRROR=process.env.TENNIS_SACKMANN_MIRROR||"https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";
const TML_BASE=process.env.TENNIS_TML_BASE||"https://stats.tennismylife.org/data";
const cutoff=process.env.TENNIS_PROFILE_CUTOFF||new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()).replaceAll("-","");
const sourceAsOf=`${cutoff.slice(0,4)}-${cutoff.slice(4,6)}-${cutoff.slice(6,8)}T00:00:00-05:00`;

const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const clean=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const surfaceKey=s=>{s=String(s||"hard").toLowerCase();return s.includes("clay")?"clay":s.includes("grass")?"grass":"hard"};
const q=v=>v==null?"NULL":`'${String(v).replaceAll("'","''")}'`;
const n=v=>Number.isFinite(Number(v))?String(Number(v)):"NULL";

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

const all=[],sourceAudits=[];
async function loadHistorical({tour,year,sourceClass,url,sourceName,required=true}){
  let txt="";
  try{txt=await fetchText(url)}
  catch(err){sourceAudits.push({source:sourceName,sourceClass,year,url,bytes:0,rows:0,serveCoverage:0,distinctPlayers:0,levels:[],safe:false,reasons:["fetch_failed"],error:err.message});return;}
  const audit={...auditTennisCsv(txt,{source:sourceName,sourceClass,year}),url};sourceAudits.push(audit);
  if(!audit.safe){process.stderr.write(`unsafe ${sourceClass} ${year}: ${audit.reasons.join(",")}\n`);return;}
  for(const r of parseTennisCsv(txt).rows)all.push({...r,_tour:tour,_year:year,_sourceClass:sourceClass,_sourceName:sourceName});
  process.stderr.write(`loaded ${sourceClass} ${year}: ${audit.rows} rows; serve ${(audit.serveCoverage*100).toFixed(1)}%\n`);
}
for(const year of ATP_TOUR_YEARS)await loadHistorical({tour:"atp",year,sourceClass:"ATP_TOUR",sourceName:"SACKMANN_ARCHIVE_RESEARCH",url:`${MIRROR}/atp/atp_matches_${year}.csv`});
for(const year of ATP_CHALLENGER_YEARS)await loadHistorical({tour:"atp",year,sourceClass:"ATP_CHALLENGER",sourceName:"TML_RESEARCH_ONLY",url:`${TML_BASE}/${year}_challenger.csv`});
for(const year of WTA_YEARS)await loadHistorical({tour:"wta",year,sourceClass:"WTA_TOUR",sourceName:"SACKMANN_ARCHIVE_RESEARCH",url:`${MIRROR}/wta/wta_matches_${year}.csv`,required:false});
assertTennisCoverage(sourceAudits,{requiredTourYears:ATP_TOUR_YEARS,requiredChallengerYears:ATP_CHALLENGER_YEARS});
all.sort((a,b)=>String(a.tourney_date).localeCompare(String(b.tourney_date))||String(a.match_num||"").localeCompare(String(b.match_num||"")));

const states={atp:new TennisDeepState("atp"),wta:new TennisDeepState("wta")};
const historyRows=[];
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
  historyRows.push({tour,source:row._sourceName||"UNKNOWN_RESEARCH",sourceClass:row._sourceClass||null,matchDate:dateIso(row.tourney_date),tournament:row.tourney_name||null,surface,round:row.round||null,p1Key:clean(row.winner_name),p1Name:row.winner_name,p2Key:clean(row.loser_name),p2Name:row.loser_name,winnerKey:clean(row.winner_name),score:row.score||null,p1Rank:finite(row.winner_rank),p2Rank:finite(row.loser_rank),p1Stats:{ace:finite(row.w_ace),df:finite(row.w_df),svpt:finite(row.w_svpt),firstIn:finite(row.w_1stIn),firstWon:finite(row.w_1stWon),secondWon:finite(row.w_2ndWon),bpSaved:finite(row.w_bpSaved),bpFaced:finite(row.w_bpFaced)},p2Stats:{ace:finite(row.l_ace),df:finite(row.l_df),svpt:finite(row.l_svpt),firstIn:finite(row.l_1stIn),firstWon:finite(row.l_1stWon),secondWon:finite(row.l_2ndWon),bpSaved:finite(row.l_bpSaved),bpFaced:finite(row.l_bpFaced)}});
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
const currentYear=Math.max(...ATP_TOUR_YEARS,...WTA_YEARS);
const tourEnv={};
for(const tour of ["atp","wta"]){
  const rows=[...tournaments.values()].filter(t=>t.tour===tour&&t.year===currentYear).flatMap(t=>t.rows);
  const ace=rows.map(r=>finite(r.aceRate)).filter(x=>x!=null);
  const spw=rows.map(r=>finite(r.servePointWin)).filter(x=>x!=null);
  tourEnv[tour]={
    ace:ace.length?ace.reduce((a,b)=>a+b,0)/ace.length:null,
    spw:spw.length?spw.reduce((a,b)=>a+b,0)/spw.length:null,
  };
}
const speedRows=[];
for(const t of tournaments.values()){
  if(t.year!==currentYear||t.rows.length<10)continue;
  const base=tourEnv[t.tour]||{};
  if(base.ace==null||base.spw==null)continue;
  const ace=t.rows.map(r=>finite(r.aceRate)).filter(x=>x!=null);
  const spw=t.rows.map(r=>finite(r.servePointWin)).filter(x=>x!=null);
  if(!ace.length||!spw.length)continue;
  const a=ace.reduce((x,y)=>x+y,0)/ace.length;
  const sw=spw.reduce((x,y)=>x+y,0)/spw.length;
  // Relative tournament environment, centered on the same-tour/current-season mean.
  // 1.00 = tour-average speed; caps prevent small samples from dominating context.
  const z=((a-base.ace)/0.035+(sw-base.spw)/0.035)/2;
  const csi=clamp(1+z*0.08,.86,1.14);
  speedRows.push({...t,courtSpeedIndex:csi,sampleSides:t.rows.length,tournamentKey:clean(t.name)});
}

const now=new Date().toISOString();
let sql=`DELETE FROM tennis_player_profiles_current;\nDELETE FROM tennis_tournament_speed_current;\n`;
for(const r of profileRows){
  sql+=`INSERT OR REPLACE INTO tennis_player_profiles_current(tour,player_key,player_id,player_name,surface,profile_json,last_match_date,last_surface,last_tournament,games_last_3_days,games_last_7_days,sets_last_3_days,sets_last_7_days,days_since_retirement_or_mto,source,source_license,source_as_of,production_dependency,updated_at) VALUES(${q(r.tour)},${q(r.playerKey)},${q(r.playerId)},${q(r.playerName)},${q(r.surface)},${q(JSON.stringify(r.profile))},${q(r.lastDate)},${q(r.lastSurface)},${q(r.lastTournament)},${n(r.gamesLast3Days)},${n(r.gamesLast7Days)},${n(r.setsLast3Days)},${n(r.setsLast7Days)},${n(r.daysSinceRetirementOrMto)},'FBIS_TENNIS_RESEARCH_COMPOSITE','RESEARCH_ONLY_MIXED_RIGHTS',${q(sourceAsOf)},0,${q(now)});
`;
}
const bankByPlayer=new Map();
for(const r of profileRows){const k=r.tour+"|"+r.playerKey;if(!bankByPlayer.has(k))bankByPlayer.set(k,r);}
for(const r of bankByPlayer.values()){
  sql+=`INSERT OR REPLACE INTO tennis_player_bank(tour,player_key,player_id,player_name,profile_json,recent_form_json,source,source_as_of,updated_at) VALUES(${q(r.tour)},${q(r.playerKey)},${q(r.playerId)},${q(r.playerName)},${q(JSON.stringify(r.profile))},NULL,'FBIS_TENNIS_RESEARCH_COMPOSITE',${q(sourceAsOf)},${q(now)});
`;
}
for(const r of historyRows){
  const mk=[r.tour,r.matchDate,r.tournament,r.p1Key,r.p2Key,r.score].join("|");
  sql+=`INSERT OR IGNORE INTO tennis_match_history(match_key,tour,match_date,tournament,surface,round,player1_key,player1_name,player2_key,player2_name,winner_key,score,player1_rank,player2_rank,player1_stats_json,player2_stats_json,source,source_as_of,created_at) VALUES(${q(mk)},${q(r.tour)},${q(r.matchDate)},${q(r.tournament)},${q(r.surface)},${q(r.round)},${q(r.p1Key)},${q(r.p1Name)},${q(r.p2Key)},${q(r.p2Name)},${q(r.winnerKey)},${q(r.score)},${n(r.p1Rank)},${n(r.p2Rank)},${q(JSON.stringify(r.p1Stats))},${q(JSON.stringify(r.p2Stats))},'FBIS_TENNIS_RESEARCH_COMPOSITE',${q(sourceAsOf)},${q(now)});
`;
}
for(const r of speedRows){
  sql+=`INSERT OR REPLACE INTO tennis_tournament_speed_current(tour,tournament_key,tournament_name,season,surface,court_speed_index,sample_sides,source,source_as_of,production_dependency,updated_at) VALUES(${q(r.tour)},${q(r.tournamentKey)},${q(r.name)},${n(r.year)},${q(r.surface)},${n(r.courtSpeedIndex)},${n(r.sampleSides)},'FBIS_TENNIS_RESEARCH_COMPOSITE',${q(sourceAsOf)},0,${q(now)});
`;
}

await fs.mkdir(path.dirname(OUT),{recursive:true});
await fs.writeFile(OUT,sql);
const summary={
  generatedAt:now,cutoffCT:cutoff,
  sources:{tour:{name:"Sackmann archive research mirror",productionDependency:false},challenger:{name:"TennisMyLife",productionDependency:false,rights:"RESEARCH_ONLY / commercial permission not established"}},
  sourceAudits,
  profiles:profileRows.length,playerBank:bankByPlayer.size,matchHistory:historyRows.length,players:{atp:meta.atp.size,wta:meta.wta.size},speedRows:speedRows.length,
  integrity:{sameDayExcluded:true,futureRowsExcluded:true,cutoff:sourceAsOf},
  missingByDesign:["travelKm7Days","timeZonesCrossed7Days","minutesLast3Days","minutesLast7Days","injuryStatus","recentServeSpeedDeltaKph","indoor","altitudeM"],
};
await fs.writeFile(SUMMARY,JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
