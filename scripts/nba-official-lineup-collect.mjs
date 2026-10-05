#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import { normalizeNbaTeamKey } from "../functions/lib/nbaTeamProfile.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const out=args.out||"artifacts/nba-official-lineups.json";
const sqlOut=args.sql||"artifacts/nba-official-lineups.sql";
const observedAt=args.observedAt||new Date().toISOString();
const maxHours=Number(args.maxHours||8);
const hash=s=>crypto.createHash("sha256").update(String(s)).digest("hex");
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const stamp=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(observedAt)).replaceAll("-","");

async function get(url){
  let last;
  for(let i=0;i<3;i++){
    try{
      const r=await fetch(url,{headers:{"user-agent":"FBIS-NBA-Lineups/1.0",accept:"application/json"}});
      if(!r.ok)throw new Error("HTTP "+r.status+" "+url);
      return r.json();
    }catch(e){last=e;await new Promise(r=>setTimeout(r,150*(i+1)))}
  }
  throw last;
}
const board=await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${stamp}&limit=100`);
const rows=[],meta=[];
for(const ev of board.events||[]){
  const comp=ev.competitions?.[0]||{},tipoff=ev.date||comp.date||null;
  const tip=Date.parse(tipoff||0),now=Date.parse(observedAt),hours=Number.isFinite(tip)?(tip-now)/3600000:null;
  const state=String(ev.status?.type?.state||comp.status?.type?.state||"").toLowerCase();
  if(state==="pre"&&(hours==null||hours>maxHours))continue;
  if(!["pre","in","post"].includes(state))continue;
  let summary={};
  try{summary=await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${ev.id}`)}
  catch(e){meta.push({gameId:String(ev.id),ok:false,error:String(e)});continue}
  let count=0;
  for(const block of summary?.boxscore?.players||[]){
    const teamKey=normalizeNbaTeamKey(block?.team?.abbreviation||"");
    for(const group of block?.statistics||[]){
      for(const a of group?.athletes||[]){
        const starter=a?.starter===true||a?.starter===1||String(a?.starter||"")==="1";
        if(!starter)continue;
        const athlete=a.athlete||{},name=athlete.displayName||a.displayName||null;
        if(!name||!teamKey)continue;
        rows.push({
          gameId:String(ev.id),teamKey,playerId:athlete.id?String(athlete.id):null,playerName:name,
          lineupStatus:"STARTER",source:"ESPN_CONFIRMED_STARTER",observedAt,
          tipoffTimestamp:tipoff,gameState:state
        });
        count++;
      }
    }
  }
  meta.push({gameId:String(ev.id),ok:true,state,tipoff,starterRows:count});
}
const dedupe=[...new Map(rows.map(r=>[[r.gameId,r.teamKey,r.playerId||r.playerName,r.lineupStatus].join("|"),r])).values()];
const sql=[];
for(const r of dedupe){
  const id="nba-lineup:"+hash([r.gameId,r.teamKey,r.playerId||r.playerName,r.lineupStatus,r.observedAt.slice(0,16)].join("|")).slice(0,32);
  sql.push(`INSERT OR IGNORE INTO nba_lineup_observations (id,game_id,team_key,player_id,player_name,lineup_status,source,observed_at,tipoff_timestamp,raw_json,created_at) VALUES (${q(id)},${q(r.gameId)},${q(r.teamKey)},${q(r.playerId)},${q(r.playerName)},${q(r.lineupStatus)},'ESPN_CONFIRMED_STARTER',${q(r.observedAt)},${q(r.tipoffTimestamp)},${q(JSON.stringify(r))},${q(observedAt)});`);
}
const result={ok:true,source:"ESPN_CONFIRMED_STARTER",observedAt,rows:dedupe,meta,quality:{games:meta.length,successfulGames:meta.filter(x=>x.ok).length,observations:dedupe.length,starters:dedupe.length}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n");
fs.writeFileSync(sqlOut,sql.join("\n")+(sql.length?"\n":""));
console.log(JSON.stringify(result.quality,null,2));
