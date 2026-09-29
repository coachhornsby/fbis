#!/usr/bin/env node
import { fetchResultsForReconcile } from "../functions/lib/slateEngineCore.js";
import { parseCsv } from "../functions/lib/nflVerseFeed.js";
import { resolveTeam } from "../functions/lib/teams.js";

const sport=String(process.argv[2]||"").toLowerCase();
const date=String(process.argv[3]||"").slice(0,10);
const supported=new Set(["mlb","nfl","cfb","cbb","nba","nhl"]);
if(!supported.has(sport) || !/^\d{4}-\d{2}-\d{2}$/.test(date)){
  console.error("usage: node scripts/fetch-final-scoreboard.mjs <sport> <YYYY-MM-DD>");
  process.exit(2);
}

const cfbdApiKey=process.env.CFBD_API_KEY||process.env.COLLEGE_DATA_API_KEY||"";
const NFLVERSE_GAMES="https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const CFBFAST_SCHEDULES_BASE="https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/schedules/csv";

function finite(v){
  if(v==null || v==="") return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function ctDate(iso){
  const ms=Date.parse(String(iso||""));
  if(!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(new Date(ms));
}
async function fetchText(url){
  const res=await fetch(url,{headers:{Accept:"text/csv,text/plain,*/*","User-Agent":"FBIS/1.0"}});
  if(!res.ok) throw new Error(`scoreboard csv ${res.status} ${url}`);
  return res.text();
}
function teamName(sportId,abbr,fallback){
  const hit=resolveTeam(sportId,{abbr,name:fallback});
  return hit?.displayName||hit?.school||fallback||abbr||"";
}
async function nflverseFinals(day){
  const rows=parseCsv(await fetchText(NFLVERSE_GAMES));
  return rows.filter(r=>String(r.gameday||"").slice(0,10)===day)
    .filter(r=>finite(r.home_score)!=null&&finite(r.away_score)!=null)
    .map(r=>({
      id:String(r.espn||r.game_id||""),
      sport:"nfl",
      date:day,
      start:null,
      home:{name:teamName("nfl",r.home_team,r.home_team),abbr:r.home_team,score:finite(r.home_score)},
      away:{name:teamName("nfl",r.away_team,r.away_team),abbr:r.away_team,score:finite(r.away_score)},
      status:{completed:true,state:"post",detail:"Final"},
      source:"nflverse/nfldata",
    }));
}
async function cfbfastFinals(day){
  const year=String(day).slice(0,4);
  const rows=parseCsv(await fetchText(`${CFBFAST_SCHEDULES_BASE}/cfb_schedules_${year}.csv`));
  return rows.filter(r=>{
      const start=r.start_date||r.game_date||"";
      return ctDate(start)===day || String(start).slice(0,10)===day;
    })
    .filter(r=>String(r.completed||"").toLowerCase()==="true")
    .filter(r=>finite(r.home_points)!=null&&finite(r.away_points)!=null)
    .map(r=>({
      id:String(r.game_id||""),
      sport:"cfb",
      date:day,
      start:r.start_date||null,
      home:{name:r.home_team||"Home",abbr:null,score:finite(r.home_points)},
      away:{name:r.away_team||"Away",abbr:null,score:finite(r.away_points)},
      status:{completed:true,state:"post",detail:"Final"},
      source:"sportsdataverse/cfbfastR-data",
    }));
}

async function trustedResults(){
  if(sport==="nfl"){
    try{
      const rows=await nflverseFinals(date);
      if(rows.length) return {rows,source:"nflverse/nfldata"};
    }catch(err){
      console.error("NFLVERSE_FALLBACK_ERROR",String(err?.message||err));
    }
  }
  if(sport==="cfb"){
    try{
      const rows=await cfbfastFinals(date);
      if(rows.length) return {rows,source:"sportsdataverse/cfbfastR-data"};
    }catch(err){
      console.error("CFBFAST_FALLBACK_ERROR",String(err?.message||err));
    }
  }

  const rows=await fetchResultsForReconcile(sport,date,{
    cfbdApiKey,
    preferCfbd:sport==="cfb" && Boolean(cfbdApiKey),
  });
  const finals=(rows||[]).filter((g)=>
    g?.status?.completed===true &&
    Number.isFinite(Number(g?.home?.score)) &&
    Number.isFinite(Number(g?.away?.score))
  ).map((g)=>({...g,date,sport:g.sport||sport}));
  return {rows:finals,source:"primary-scoreboard"};
}

try{
  const out=await trustedResults();
  process.stdout.write(JSON.stringify({
    sport,
    date,
    source:out.source,
    finals:out.rows,
    fetched:out.rows.length,
    completed:out.rows.length,
    generatedAt:new Date().toISOString(),
  }));
}catch(err){
  console.error(String(err?.stack||err?.message||err));
  process.exit(1);
}
