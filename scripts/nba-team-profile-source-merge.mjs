#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const input=process.argv[2]||"artifacts/profile-source-shards";
const out=process.argv[3]||"artifacts/nba-team-profile-source.json";
const files=[];
function walk(p){
  if(!fs.existsSync(p))return;
  const s=fs.statSync(p);
  if(s.isFile()){if(p.endsWith(".json"))files.push(p);return}
  for(const n of fs.readdirSync(p))walk(path.join(p,n));
}
walk(input);
const teams=new Map();let season=null,generatedAt=null;
for(const f of files){
  const j=JSON.parse(fs.readFileSync(f,"utf8"));
  season=season??j.season;generatedAt=generatedAt??j.generatedAt;
  for(const t of j.teams||[])teams.set(String(t.teamId),t);
}
const rows=[...teams.values()].sort((a,b)=>a.teamName.localeCompare(b.teamName));
if(rows.length!==30)throw new Error("expected 30 NBA teams, got "+rows.length);
const payload={
  generatedAt:new Date().toISOString(),season,source:"ESPN_PUBLIC_SHARDED",
  teams:rows,
  quality:{
    teams:rows.length,
    rostersOk:rows.filter(x=>x.sourceState?.roster==="OK").length,
    schedulesOk:rows.filter(x=>x.sourceState?.schedule==="OK").length,
    players:rows.reduce((s,x)=>s+(x.roster?.length||0),0),
    coaches:rows.reduce((s,x)=>s+(x.coaches?.length||0),0),
    games:rows.reduce((s,x)=>s+(x.schedule?.length||0),0)
  }
};
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");
console.log(JSON.stringify(payload.quality,null,2));
