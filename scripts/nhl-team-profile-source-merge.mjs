#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const dir=process.argv[2]||"artifacts/profile-source-shards",out=process.argv[3]||"artifacts/nhl-team-profile-source.json";
const files=[];function walk(p){for(const n of fs.readdirSync(p)){const f=path.join(p,n),s=fs.statSync(f);if(s.isDirectory())walk(f);else if(n.endsWith(".json"))files.push(f)}}walk(dir);
const parts=files.map(f=>JSON.parse(fs.readFileSync(f,"utf8"))),teams=[...new Map(parts.flatMap(x=>x.teams||[]).map(x=>[x.teamKey,x])).values()].sort((a,b)=>a.teamKey.localeCompare(b.teamKey));
const payload={generatedAt:new Date().toISOString(),seasonId:parts.find(x=>x.seasonId)?.seasonId||null,teams,quality:{teams:teams.length,players:teams.reduce((s,x)=>s+(x.roster?.length||0),0),scheduleItems:teams.reduce((s,x)=>s+(x.schedule?.length||0),0),shiftTeams:teams.filter(x=>x.sourceState?.shifts==="OK").length,errors:teams.reduce((s,x)=>s+(x.errors?.length||0),0)}};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");console.log(JSON.stringify(payload.quality,null,2));
