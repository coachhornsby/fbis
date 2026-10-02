#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { cfbdGet } from "../functions/lib/collegeApi.js";

const env={CFBD_API_KEY:process.env.CFBD_API_KEY||""};
if(!env.CFBD_API_KEY){console.error("CFBD_API_KEY missing");process.exit(2);}
const start=Number(process.env.CFB_HISTORY_START||2000);
const end=Number(process.env.CFB_HISTORY_END||2026);
const years=[]; for(let y=start;y<=end;y++) years.push(y);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const firstObj=(x)=>Array.isArray(x)?x[0]:x;
const fields=(x)=>{
  const o=firstObj(x);
  if(!o||typeof o!=="object") return [];
  const out=[...Object.keys(o)];
  for(const [k,v] of Object.entries(o)) if(v&&typeof v==="object"&&!Array.isArray(v)) for(const kk of Object.keys(v)) out.push(k+"."+kk);
  return out.sort();
};
async function get(path,query){
  const r=await cfbdGet(path,env,{query,skipCache:true});
  await sleep(75);
  return {ok:r.ok,status:r.status,n:Array.isArray(r.data)?r.data.length:(r.data?1:0),fields:fields(r.data),sample:firstObj(r.data)||null,reason:r.reason||null};
}
const report={generatedAt:new Date().toISOString(),start,end,years:{}};
for(const year of years){
  const yr={};
  yr.games=await get("/games",{year,seasonType:"both"});
  yr.lines=await get("/lines",{year,seasonType:"both"});
  yr.sp=await get("/ratings/sp",{year});
  yr.fpi=await get("/ratings/fpi",{year});
  yr.srs=await get("/ratings/srs/expanded",{year});
  yr.eloPreseason=await get("/ratings/elo",{year,preseason:true,seasonType:"regular"});
  yr.core=await get("/ratings/core",{year});
  yr.talent=await get("/talent",{year});
  yr.recruitingTeams=await get("/recruiting/teams",{year});
  yr.returning=await get("/player/returning",{year});
  const weeks=[1,5,10,15];
  yr.weekSamples={};
  for(const week of weeks){
    yr.weekSamples[week]={
      ppa:await get("/ppa/games",{year,week,seasonType:"regular"}),
      advanced:await get("/stats/game/advanced",{year,week,seasonType:"regular"}),
      plays:await get("/plays",{year,week,seasonType:"regular",classification:"fbs"}),
      drives:await get("/drives",{year,week,seasonType:"regular"}),
      players:await get("/games/players",{year,week,seasonType:"regular"})
    };
  }
  report.years[year]=yr;
  console.error(JSON.stringify({year,games:yr.games.n,lines:yr.lines.n,sp:yr.sp.n,fpi:yr.fpi.n,srs:yr.srs.n,core:yr.core.n,week1:{ppa:yr.weekSamples[1].ppa.n,advanced:yr.weekSamples[1].advanced.n,plays:yr.weekSamples[1].plays.n}}));
}
const endpointNames=["games","lines","sp","fpi","srs","eloPreseason","core","talent","recruitingTeams","returning"];
const coverage={};
for(const k of endpointNames){
  const ys=years.filter(y=>report.years[y][k]?.n>0);
  coverage[k]={first:ys[0]??null,last:ys.at(-1)??null,seasons:ys.length};
}
for(const k of ["ppa","advanced","plays","drives","players"]){
  const ys=years.filter(y=>Object.values(report.years[y].weekSamples||{}).some(w=>w[k]?.n>0));
  coverage[k]={first:ys[0]??null,last:ys.at(-1)??null,seasons:ys.length};
}
report.coverage=coverage;
mkdirSync("artifacts/cfb-history",{recursive:true});
writeFileSync("artifacts/cfb-history/coverage.json",JSON.stringify(report,null,2));
writeFileSync("artifacts/cfb-history/coverage-summary.json",JSON.stringify({generatedAt:report.generatedAt,start,end,coverage},null,2));
console.log(JSON.stringify({coverage},null,2));
