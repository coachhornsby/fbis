#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const dir=process.argv[2]||"artifacts/chunks";
const out=process.argv[3]||"artifacts/wnba-canonical.jsonl";
const files=[];
function walk(p){
  for(const n of fs.readdirSync(p)){
    const f=path.join(p,n),s=fs.statSync(f);
    if(s.isDirectory())walk(f);
    else if(n.endsWith(".jsonl")&&!/pbp|stint/i.test(n))files.push(f);
  }
}
walk(dir);
const map=new Map();
for(const f of files){
  for(const line of fs.readFileSync(f,"utf8").split("\n")){
    if(!line.trim())continue;
    const r=JSON.parse(line);
    if(!r?.id)continue;
    // Canonical game rows must carry team/score fields. This excludes unrelated JSONL artifacts.
    if(r.homeScore==null||r.awayScore==null||!r.home||!r.away)continue;
    map.set(String(r.id),r);
  }
}
const rows=[...map.values()].sort((a,b)=>Date.parse(a.start||a.date||0)-Date.parse(b.start||b.date||0));
const playerRows=rows.flatMap(r=>Array.isArray(r.players)?r.players:[]);
const playerGames=rows.filter(r=>Array.isArray(r.players)&&r.players.length>0).length;
const uniquePlayers=new Set(playerRows.map(p=>String(p.id||p.name||"")).filter(Boolean)).size;
const playerGameCoverage=rows.length?playerGames/rows.length:0;
if(rows.length&&playerGameCoverage<0.90){
  throw new Error(`WNBA canonical merge quality fail: player game coverage ${playerGameCoverage}`);
}
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,rows.map(JSON.stringify).join("\n")+(rows.length?"\n":""));
console.log(JSON.stringify({ok:true,files:files.length,rows:rows.length,playerRows:playerRows.length,uniquePlayers,playerGameCoverage,out},null,2));
