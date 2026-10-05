#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import { normalizeNbaTeamKey } from "../functions/lib/nbaTeamProfile.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const out=args.out||"artifacts/nba-official-lineups.json";
const sqlOut=args.sql||"artifacts/nba-official-lineups.sql";
const observedAt=args.observedAt||new Date().toISOString();
const maxHours=Number(args.maxHours||8);
const scoreboardUrl="https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";
const ua={"user-agent":"FBIS-NBA-Team-Profiles/1.0",accept:"application/json"};
const hash=s=>crypto.createHash("sha256").update(String(s)).digest("hex");
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
async function get(url){const r=await fetch(url,{headers:ua});if(!r.ok)throw new Error("HTTP "+r.status+" "+url);return r.json()}
const board=await get(scoreboardUrl);
const games=board?.scoreboard?.games||[];
const rows=[],meta=[];
for(const g of games){
 const gameId=String(g.gameId||"");if(!gameId)continue;
 const tipoff=g.gameTimeUTC||g.gameEt||null,tip=Date.parse(tipoff||0),now=Date.parse(observedAt);
 const hours=Number.isFinite(tip)?(tip-now)/3600000:null;
 const status=Number(g.gameStatus||0);
 if(status===1&&(hours==null||hours>maxHours))continue;
 if(![1,2,3].includes(status))continue;
 let box;
 try{box=await get(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`)}catch(e){meta.push({gameId,ok:false,error:String(e)});continue}
 const game=box?.game||{},teams=[game.homeTeam,game.awayTeam].filter(Boolean);
 let written=0;
 for(const team of teams){
   const teamKey=normalizeNbaTeamKey(team.teamTricode);
   for(const p of team.players||[]){
     const starter=String(p.starter||"")==="1";
     const active=String(p.status||"").toUpperCase()==="ACTIVE";
     const inactive=!active&&String(p.status||"").trim()!=="";
     if(!starter&&!active&&!inactive)continue;
     const lineupStatus=starter?"STARTER":active?"ACTIVE":"INACTIVE";
     const name=[p.firstName,p.familyName].filter(Boolean).join(" ")||p.name||p.nameI||null;
     if(!name)continue;
     rows.push({
       gameId,teamKey,playerId:null,officialPersonId:p.personId?String(p.personId):null,
       playerName:name,lineupStatus,source:"NBA_OFFICIAL_LIVE_BOXSCORE",
       observedAt,tipoffTimestamp:game.gameTimeUTC||tipoff||null,
       gameStatus:Number(game.gameStatus||status),gameStatusText:game.gameStatusText||g.gameStatusText||null,
       starter,active,played:String(p.played||"")==="1"
     });
     written++;
   }
 }
 meta.push({gameId,ok:true,status:Number(game.gameStatus||status),tipoff:game.gameTimeUTC||tipoff||null,rows:written});
}
const dedupe=[...new Map(rows.map(r=>[[r.gameId,r.teamKey,r.playerName,r.lineupStatus].join("|"),r])).values()];
const sql=[];
for(const r of dedupe){
 const id="nba-lineup:"+hash([r.gameId,r.teamKey,r.playerName,r.lineupStatus,r.observedAt.slice(0,16)].join("|")).slice(0,32);
 sql.push(`INSERT OR IGNORE INTO nba_lineup_observations (id,game_id,team_key,player_id,player_name,lineup_status,source,observed_at,tipoff_timestamp,raw_json,created_at) VALUES (${q(id)},${q(r.gameId)},${q(r.teamKey)},NULL,${q(r.playerName)},${q(r.lineupStatus)},'NBA_OFFICIAL_LIVE_BOXSCORE',${q(r.observedAt)},${q(r.tipoffTimestamp)},${q(JSON.stringify(r))},${q(observedAt)});`);
}
const result={ok:true,source:"NBA_OFFICIAL_LIVE_BOXSCORE",observedAt,rows:dedupe,meta,quality:{games:meta.length,successfulGames:meta.filter(x=>x.ok).length,observations:dedupe.length,starters:dedupe.filter(x=>x.lineupStatus==="STARTER").length,active:dedupe.filter(x=>x.lineupStatus==="ACTIVE").length,inactive:dedupe.filter(x=>x.lineupStatus==="INACTIVE").length}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n");
fs.writeFileSync(sqlOut,sql.join("\n")+(sql.length?"\n":""));
console.log(JSON.stringify(result.quality,null,2));
