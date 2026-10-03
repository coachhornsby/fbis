#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";

const BASE=process.env.FBIS_BASE||"https://fbis-myz.pages.dev";
const SECRET=process.env.HARVEST_SECRET||"";
const START=Number(process.env.CFB_CONF_START||2004);
const END=Number(process.env.CFB_CONF_END||2026);
if(!SECRET){console.error("HARVEST_SECRET missing");process.exit(2);}
mkdirSync("artifacts/cfb-conference",{recursive:true});

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const norm=(v)=>String(v??"").trim();
const esc=(v)=>'"'+String(v??"").replaceAll('"','""')+'"';
const csv=(rows,cols)=>[cols.join(","),...rows.map(r=>cols.map(c=>{
  const v=r[c]; if(v==null)return ""; if(typeof v==="number")return String(v); return esc(v);
}).join(","))].join("\n")+"\n";

async function pull(year,seasonType){
  const u=new URL("/api/cfb-history-chunk",BASE);
  for(const [k,v] of Object.entries({year,weekStart:0,weekEnd:25,seasonType,coverageOnly:1}))u.searchParams.set(k,String(v));
  for(let attempt=1;attempt<=5;attempt++){
    const res=await fetch(u,{headers:{"x-harvest-secret":SECRET,accept:"application/json"}});
    const body=await res.json().catch(()=>({}));
    if(res.ok&&body.ok)return body.games||[];
    if(attempt===5)throw new Error(`conference pull failed year=${year} type=${seasonType} status=${res.status} error=${body.error||"unknown"}`);
    await sleep(attempt*1500);
  }
}

const games=[];
for(let year=START;year<=END;year++){
  for(const seasonType of ["regular","postseason"]){
    const rows=await pull(year,seasonType);
    games.push(...rows);
    console.error(JSON.stringify({year,seasonType,games:rows.length}));
    await sleep(100);
  }
}
const uniq=new Map();
for(const g of games){
  const id=norm(g.gameId); if(!id)continue;
  uniq.set(id,{
    game_id:id,season:Number(g.season),week:Number(g.week),season_type:g.seasonType||null,
    home_team:g.homeTeam||null,away_team:g.awayTeam||null,
    home_conference:g.homeConference||null,away_conference:g.awayConference||null,
    home_classification:g.homeClassification||null,away_classification:g.awayClassification||null,
    neutral_site:g.neutralSite?1:0,conference_game:g.conferenceGame?1:0,
    venue:g.venue||null,venue_id:g.venueId||null,start_date:g.startDate||null
  });
}
const rows=[...uniq.values()].sort((a,b)=>a.season-b.season||a.week-b.week||a.game_id.localeCompare(b.game_id));
writeFileSync("artifacts/cfb-conference/cfb_game_conferences_2004_2026.csv",csv(rows,Object.keys(rows[0]||{})));

const teamSeasons=new Map(), conflicts=[];
for(const g of rows){
  for(const side of ["home","away"]){
    const team=g[side+"_team"], conf=g[side+"_conference"], cls=g[side+"_classification"];
    if(!team||!conf)continue;
    const k=`${g.season}|${team.toLowerCase()}`;
    if(!teamSeasons.has(k))teamSeasons.set(k,{season:g.season,team,conference:conf,classification:cls,games:0,source:"CFBD_GAME"});
    const x=teamSeasons.get(k);x.games++;
    if(x.conference!==conf)conflicts.push({season:g.season,team,first:x.conference,other:conf,game_id:g.game_id});
  }
}
const dim=[...teamSeasons.values()].sort((a,b)=>a.season-b.season||a.team.localeCompare(b.team));
writeFileSync("artifacts/cfb-conference/cfb_team_season_conference_2004_2026.csv",csv(dim,Object.keys(dim[0]||{})));
const qa={
 generatedAt:new Date().toISOString(),startSeason:START,endSeason:END,gameRows:rows.length,
 gamesWithBothConferences:rows.filter(r=>r.home_conference&&r.away_conference).length,
 teamSeasonRows:dim.length,conflicts:conflicts.length,conflictExamples:conflicts.slice(0,25),
 seasons:[...new Set(rows.map(r=>r.season))].sort((a,b)=>a-b),
 policy:"CFBD /games via protected FBIS history endpoint. Game-level conference fields are authoritative; team-season dimension is a consistency cross-check."
};
writeFileSync("artifacts/cfb-conference/qa.json",JSON.stringify(qa,null,2));
if(!rows.length||qa.gamesWithBothConferences===0)throw new Error("CFBD conference history empty");
if(qa.conflicts>0)throw new Error(`CFBD team-season conference conflicts detected: ${qa.conflicts}`);
console.log(JSON.stringify(qa,null,2));
