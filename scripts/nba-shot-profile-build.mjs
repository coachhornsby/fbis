#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildGameShotProfiles } from "../functions/lib/nbaShotProfile.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const input=args.input||"artifacts/pbp";
const out=args.out||"artifacts/nba-shot-profiles.jsonl";
const files=[];
function walk(p){
  if(!fs.existsSync(p))return;
  const s=fs.statSync(p);if(s.isFile()){files.push(p);return}
  for(const n of fs.readdirSync(p))walk(path.join(p,n));
}
walk(input);
const rows=[];
for(const f of files.filter(x=>x.endsWith(".jsonl")&&/nba-pbp/.test(path.basename(x)))){
  for(const line of fs.readFileSync(f,"utf8").split("\n")){
    if(!line.trim())continue;
    const g=JSON.parse(line),profiles=buildGameShotProfiles(g);
    rows.push({gameId:String(g.id),date:g.date,start:g.start,homeId:String(g.homeId||""),awayId:String(g.awayId||""),profiles});
  }
}
const dedupe=[...new Map(rows.map(r=>[r.gameId,r])).values()].sort((a,b)=>Date.parse(a.start||a.date)-Date.parse(b.start||b.date));
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,dedupe.map(JSON.stringify).join("\n")+(dedupe.length?"\n":""));
const coverage=dedupe.length?dedupe.filter(r=>Object.values(r.profiles||{}).some(x=>(x.attempts||0)>=50)).length/dedupe.length:0;
console.log(JSON.stringify({ok:true,files:files.length,games:dedupe.length,coverage,out},null,2));
