#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const BASE=process.env.WTA_API_BASE||"https://api.wtatennis.com/tennis";
const OUT=process.env.WTA_AUDIT_SQL||"artifacts/wta-source-audit.sql";
const SUMMARY=process.env.WTA_AUDIT_SUMMARY||"artifacts/wta-source-audit-summary.json";
const now=new Date().toISOString();
const q=v=>v==null?"NULL":`'${String(v).replaceAll("'","''")}'`;
const hash=v=>crypto.createHash("sha256").update(String(v)).digest("hex").slice(0,32);
const keys=o=>o&&typeof o==="object"?Object.keys(o).sort():[];
const dateStrings=(obj,out=[])=>{if(obj==null)return out;if(Array.isArray(obj)){for(const x of obj)dateStrings(x,out);return out}if(typeof obj==="object"){for(const [k,v] of Object.entries(obj)){if(/date|time|start|end/i.test(k)&&typeof v==="string"&&/^\d{4}-\d{2}-\d{2}/.test(v))out.push(v.slice(0,10));else dateStrings(v,out)}}return out};
async function get(pathname){
  const r=await fetch(BASE+pathname,{headers:{"accept":"application/json","user-agent":"FBIS-WTA-Audit/1.0"}});
  let body=null;try{body=await r.json()}catch{}
  return {status:r.status,ok:r.ok,body};
}
const ranked=await get("/players/ranked?type=rankSingles&metric=singles&page=0&pageSize=5");
const rankedRows=Array.isArray(ranked.body)?ranked.body:(ranked.body?.content||[]);
const pid=rankedRows?.[0]?.player?.id||null;
const player=pid?await get(`/players/${pid}`):{status:null,ok:false,body:null};
const matches=pid?await get(`/players/${pid}/matches`):{status:null,ok:false,body:null};
const tournaments=await get("/tournaments?page=0&pageSize=5");
const trows=Array.isArray(tournaments.body)?tournaments.body:(tournaments.body?.content||[]);
const group=trows?.[0]?.tournamentGroup?.id||null,year=trows?.[0]?.year||null;
const tournament=(group&&year)?await get(`/tournaments/${group}/${year}`):{status:null,ok:false,body:null};
const tournamentMatches=(group&&year)?await get(`/tournaments/${group}/${year}/matches`):{status:null,ok:false,body:null};
const tournamentPlayers=(group&&year)?await get(`/tournaments/${group}/${year}/players`):{status:null,ok:false,body:null};

const defs=[
 ["rankings","/players/ranked",ranked],
 ["player_profile","/players/{playerId}",player],
 ["player_matches","/players/{playerId}/matches",matches],
 ["tournaments","/tournaments",tournaments],
 ["tournament_detail","/tournaments/{groupId}/{year}",tournament],
 ["tournament_matches","/tournaments/{groupId}/{year}/matches",tournamentMatches],
 ["tournament_players","/tournaments/{groupId}/{year}/players",tournamentPlayers],
];
let sql="";const audits=[];
for(const [key,pathname,res] of defs){
  const body=res.body;
  const arr=Array.isArray(body)?body:(body?.content||body?.matches||body?.players||[]);
  const dates=dateStrings(body).sort();
  const inventory={topLevel:keys(body),sample:keys(Array.isArray(arr)?arr[0]:null),samplePlayer:keys(Array.isArray(arr)?arr[0]?.player:null)};
  const detail={samplePlayerId:pid,tournamentGroupId:group,tournamentYear:year};
  const audit={endpointKey:key,path:pathname,httpStatus:res.status,available:Boolean(res.ok),sampleCount:Array.isArray(arr)?arr.length:null,earliestDate:dates[0]||null,latestDate:dates.at(-1)||null,fieldInventory:inventory,detail};
  audits.push(audit);
  const id="tsa_"+hash(["WTA_OFFICIAL","wta",key,now].join("|"));
  sql+=`INSERT OR IGNORE INTO tennis_source_audits(audit_id,source,tour,endpoint_key,endpoint_path,http_status,available,sample_count,earliest_date,latest_date,field_inventory_json,detail_json,observed_at,created_at) VALUES(${q(id)},'WTA_OFFICIAL','wta',${q(key)},${q(pathname)},${res.status??"NULL"},${res.ok?1:0},${Number.isFinite(Number(audit.sampleCount))?Number(audit.sampleCount):"NULL"},${q(audit.earliestDate)},${q(audit.latestDate)},${q(JSON.stringify(inventory))},${q(JSON.stringify(detail))},${q(now)},${q(now)});\n`;
}
await fs.mkdir(path.dirname(OUT),{recursive:true});await fs.writeFile(OUT,sql);
const summary={generatedAt:now,source:"WTA_OFFICIAL",samplePlayerId:pid,tournamentGroupId:group,tournamentYear:year,endpoints:audits,notes:{headToHeadEndpoint:"not_assumed",statsLeadersEndpoint:"not_assumed",largeHistoricalAcquisition:false}};
await fs.writeFile(SUMMARY,JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
if(!ranked.ok||!player.ok)process.exitCode=2;
