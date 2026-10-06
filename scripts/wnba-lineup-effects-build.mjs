#!/usr/bin/env node
import fs from "node:fs";
import { aggregateLineupEffects } from "../functions/lib/wnbaLineupModel.js";
const input=process.argv[2]||"artifacts/wnba-lineup-stints.jsonl",out=process.argv[3]||"artifacts/wnba-lineup-effects.json";
const rows=fs.existsSync(input)&&fs.statSync(input).size?fs.readFileSync(input,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const effects=aggregateLineupEffects(rows,20);
const quality={stints:rows.length,totalPossessions:rows.reduce((s,x)=>s+(Number(x.possessions)||0),0),fiveMan:effects.filter(x=>x.kind==="five").length,pair:effects.filter(x=>x.kind==="pair").length,trio:effects.filter(x=>x.kind==="trio").length};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});fs.writeFileSync(out,JSON.stringify({generatedAt:new Date().toISOString(),quality,effects},null,2)+"\n");
console.log(JSON.stringify({ok:true,out,quality},null,2));
