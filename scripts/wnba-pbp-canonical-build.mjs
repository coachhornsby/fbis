#!/usr/bin/env node
import fs from "node:fs";
import { normalizeEspnPlay, parseSubstitution } from "../functions/lib/nbaLineupModel.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const start=args.start||"2025-05-16",end=args.end||start;
const out=args.out||"artifacts/wnba-pbp.jsonl";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function dates(a,b){const xs=[];for(let t=Date.parse(a+"T12:00:00Z"),e=Date.parse(b+"T12:00:00Z");t<=e;t+=86400000)xs.push(new Date(t).toISOString().slice(0,10));return xs}
async function get(url){let last;for(let i=0;i<4;i++){try{const r=await fetch(url,{headers:{"user-agent":"FBIS-WNBA-PBP/1.0",accept:"application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}catch(e){last=e;await sleep(250*(i+1))}}throw last}
const rows=[];
for(const date of dates(start,end)){
  const stamp=date.replaceAll("-","");
  const board=await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${stamp}&limit=100`);
  for(const ev of board.events||[]){
    const comp=ev.competitions?.[0],done=ev.status?.type?.completed||comp?.status?.type?.completed;
    if(!done)continue;
    let summary={};try{summary=await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${ev.id}`)}catch{}
    const plays=(summary?.plays||[]).map(normalizeEspnPlay);
    const substitutions=(summary?.plays||[]).map(parseSubstitution).filter(Boolean);
    const comps=comp?.competitors||[],h=comps.find(x=>x.homeAway==="home"),a=comps.find(x=>x.homeAway==="away");
    rows.push({id:String(ev.id),date,start:ev.date,homeId:String(h?.team?.id||""),awayId:String(a?.team?.id||""),plays,substitutions});
    await sleep(20);
  }
}
const quality={
  games:rows.length,
  gamesWithPlays:rows.filter(r=>r.plays.length>0).length,
  gamesWithSubstitutions:rows.filter(r=>r.substitutions.length>0).length,
  plays:rows.reduce((s,r)=>s+r.plays.length,0),
  substitutions:rows.reduce((s,r)=>s+r.substitutions.length,0)
};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,rows.map(JSON.stringify).join("\n")+(rows.length?"\n":""));
fs.writeFileSync(out.replace(/\.jsonl$/,"-manifest.json"),JSON.stringify({source:"ESPN_PUBLIC",sourceVersion:"pbp-v1",start,end,builtAt:new Date().toISOString(),quality},null,2)+"\n");
console.log(JSON.stringify({ok:true,out,quality},null,2));
