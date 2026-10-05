#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const input=process.argv[2]||"artifacts/mlb-profile-shards";
const out=process.argv[3]||"artifacts/mlb-persistent-profiles.json";
const files=[];
function walk(p){if(!fs.existsSync(p))return;const s=fs.statSync(p);if(s.isFile()){if(p.endsWith(".json"))files.push(p);return}for(const n of fs.readdirSync(p))walk(path.join(p,n))}
walk(input);
const teams=new Map(),errors=[];let asOf=null,season=null,sourceVersion="mlb-state-v1",sourceCalls=0;
for(const f of files){const j=JSON.parse(fs.readFileSync(f,"utf8"));asOf=asOf||j.asOf;season=season||j.season;sourceVersion=j.sourceVersion||sourceVersion;sourceCalls+=Number(j.quality?.sourceCalls||0);for(const t of j.teams||[])teams.set(String(t.teamId),t);errors.push(...(j.errors||[]))}
const rows=[...teams.values()].sort((a,b)=>a.teamName.localeCompare(b.teamName));
const payload={generatedAt:new Date().toISOString(),asOf,season,sourceVersion,teams:rows,errors,quality:{teams:rows.length,players:rows.reduce((s,t)=>s+(t.roster?.length||0),0),pitchers:rows.reduce((s,t)=>s+(t.pitchers?.length||0),0),hitters:rows.reduce((s,t)=>s+(t.hitters?.length||0),0),pitcherStatcast:rows.reduce((s,t)=>s+(t.pitchers||[]).filter(x=>x.statcastProfile).length,0),hitterStatcast:rows.reduce((s,t)=>s+(t.hitters||[]).filter(x=>x.statcastProfile).length,0),sourceCalls,errors:errors.length}};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");console.log(JSON.stringify(payload.quality,null,2));
