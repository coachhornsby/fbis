#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const dir=process.argv[2]||"artifacts/chunks",out=process.argv[3]||"artifacts/wnba-canonical.jsonl";
const files=[];const walk=p=>{for(const n of fs.readdirSync(p)){const f=path.join(p,n),s=fs.statSync(f);s.isDirectory()?walk(f):n.endsWith(".jsonl")&&files.push(f)}};walk(dir);
const map=new Map();
for(const f of files)for(const line of fs.readFileSync(f,"utf8").split("\n")){if(!line.trim())continue;const r=JSON.parse(line);if(r?.id)map.set(String(r.id),r)}
const rows=[...map.values()].sort((a,b)=>Date.parse(a.start||a.date||0)-Date.parse(b.start||b.date||0));
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,rows.map(JSON.stringify).join("\n")+(rows.length?"\n":""));
console.log(JSON.stringify({ok:true,files:files.length,rows:rows.length,out},null,2));
