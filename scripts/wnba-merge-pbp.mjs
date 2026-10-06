#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const dir=process.argv[2]||"artifacts/pbp";
const out=process.argv[3]||"artifacts/wnba-pbp.jsonl";
const files=[];
function walk(p){
  if(!fs.existsSync(p))return;
  const s=fs.statSync(p);
  if(s.isFile()){if(p.endsWith(".jsonl"))files.push(p);return;}
  for(const n of fs.readdirSync(p))walk(path.join(p,n));
}
walk(dir);
const map=new Map();
for(const f of files){
  for(const line of fs.readFileSync(f,"utf8").split("\n")){
    if(!line.trim())continue;
    const r=JSON.parse(line);
    if(!r?.id||!Array.isArray(r.plays))continue;
    map.set(String(r.id),r);
  }
}
const rows=[...map.values()].sort((a,b)=>Date.parse(a.start||a.date||0)-Date.parse(b.start||b.date||0));
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,rows.map(JSON.stringify).join("\n")+(rows.length?"\n":""));
console.log(JSON.stringify({ok:true,files:files.length,games:rows.length,plays:rows.reduce((s,r)=>s+r.plays.length,0),out},null,2));
