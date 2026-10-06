#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const dir=process.argv[2]||"artifacts/stints",out=process.argv[3]||"artifacts/wnba-lineup-stints.jsonl";
const files=[];const walk=p=>{for(const n of fs.readdirSync(p)){const f=path.join(p,n),s=fs.statSync(f);s.isDirectory()?walk(f):n.endsWith(".jsonl")&&files.push(f)}};walk(dir);
const map=new Map();
for(const f of files)for(const line of fs.readFileSync(f,"utf8").split("\n")){if(!line.trim())continue;const r=JSON.parse(line);
 const key=[r.gameId,r.startElapsed,r.endElapsed,(r.homePlayers||[]).join(","),(r.awayPlayers||[]).join(",")].join("|");map.set(key,r)}
const rows=[...map.values()].sort((a,b)=>Date.parse(a.date||0)-Date.parse(b.date||0)||Number(a.startElapsed||0)-Number(b.startElapsed||0));
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,rows.map(JSON.stringify).join("\n")+(rows.length?"\n":""));
console.log(JSON.stringify({ok:true,files:files.length,stints:rows.length,out},null,2));
