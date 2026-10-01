#!/usr/bin/env node
import { fetchResultsForReconcile } from "../functions/lib/slateEngineCore.js";
import { parseCsv } from "../functions/lib/nflVerseFeed.js";
import { resolveTeam } from "../functions/lib/teams.js";

const sport=String(process.argv[2]||"").toLowerCase();
const date=String(process.argv[3]||"").slice(0,10);
const supported=new Set(["mlb","nfl","cfb","cbb","nba","wnba","nhl","soccer"]);
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
function finalKey(g){
  const id=String(g?.id||"").trim();
  if(id) return "id:"+id;
  const away=String(g?.away?.abbr||g?.away?.name||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const home=String(g?.home?.abbr||g?.home?.name||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const start=String(g?.start||g?.date||"");
  const as=finite(g?.away?.score), hs=finite(g?.home?.score);
  return `g:${away}@${home}|${start}|${as}|${hs}`;
}
function mergeFinals(...lists){
  const out=[];
  const seen=new Set();
  for(const list of lists){
    for(const g of list||[]){
      const k=finalKey(g);
      if(seen.has(k)) continue;
      seen.add(k);
      out.push(g);
    }
  }
  return out;
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
async function espnCfbGroupedFinals(day){
  const stamp=String(day).replace(/-/g,"");
  const groups=["80","81","35"];
  const out=[];
  for(const group of groups){
    try{
      const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${stamp}&limit=500&groups=${group}`;
      const json=JSON.parse(await fetchText(url));
      for(const ev of json.events||[]){
        const comp=ev?.competitions?.[0];
        const competitors=comp?.competitors||[];
        const home=competitors.find(x=>x.homeAway==="home");
        const away=competitors.find(x=>x.homeAway==="away");
        const hs=finite(home?.score), as=finite(away?.score);
        const completed=ev?.status?.type?.completed===true || comp?.status?.type?.completed===true || /final/i.test(String(ev?.status?.type?.detail||comp?.status?.type?.detail||""));
        if(!home||!away||!completed||hs==null||as==null) continue;
        out.push({
          id:String(ev.id||comp?.id||""),
          sport:"cfb",
          date:day,
          start:ev.date||comp?.date||null,
          home:{
            name:home.team?.location||home.team?.shortDisplayName||home.team?.displayName||"Home",
            abbr:home.team?.abbreviation||null,
            score:hs
          },
          away:{
            name:away.team?.location||away.team?.shortDisplayName||away.team?.displayName||"Away",
            abbr:away.team?.abbreviation||null,
            score:as
          },
          status:{completed:true,state:"post",detail:"Final"},
          source:`espn-group-${group}`,
        });
      }
    }catch(err){
      console.error("ESPN_CFB_GROUP_FALLBACK_ERROR",group,String(err?.message||err));
    }
  }
  return out;
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

async function primaryFinals(){
  const rows=await fetchResultsForReconcile(sport,date,{
    cfbdApiKey,
    // On GitHub-hosted runners ESPN can cover FCS/secondary games that CFBD
    // schedules may omit. Keep CFBD as the automatic fallback on ESPN failure.
    preferCfbd:false,
  });
  return (rows||[]).filter((g)=>
    g?.status?.completed===true &&
    finite(g?.home?.score)!=null &&
    finite(g?.away?.score)!=null
  ).map((g)=>({...g,date,sport:g.sport||sport}));
}

async function trustedResults(){
  let primary=[];
  let primaryError=null;
  try{
    primary=await primaryFinals();
  }catch(err){
    primaryError=String(err?.message||err);
    console.error("PRIMARY_SCOREBOARD_ERROR",primaryError);
  }

  if(sport==="nfl"){
    let publicRows=[];
    try{
      publicRows=await nflverseFinals(date);
    }catch(err){
      console.error("NFLVERSE_FALLBACK_ERROR",String(err?.message||err));
    }
    const rows=mergeFinals(primary,publicRows);
    if(rows.length) return {rows,source:primary.length&&publicRows.length?"primary+nflverse":"nflverse/nfldata"};
  }

  if(sport==="cfb"){
    let publicRows=[];
    let groupedRows=[];
    try{
      publicRows=await cfbfastFinals(date);
    }catch(err){
      console.error("CFBFAST_FALLBACK_ERROR",String(err?.message||err));
    }
    try{
      groupedRows=await espnCfbGroupedFinals(date);
    }catch(err){
      console.error("ESPN_CFB_GROUPS_FALLBACK_ERROR",String(err?.message||err));
    }
    const rows=mergeFinals(primary,publicRows,groupedRows);
    if(rows.length) {
      const sources=[
        primary.length?"primary":null,
        publicRows.length?"cfbfastR":null,
        groupedRows.length?"espn-groups-80-81-35":null,
      ].filter(Boolean).join("+");
      return {rows,source:sources||"cfb-trusted-finals"};
    }
  }

  if(primary.length) return {rows:primary,source:"primary-scoreboard"};
  if(primaryError) throw new Error(primaryError);
  return {rows:[],source:"primary-scoreboard"};
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
