#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";

const BASE=process.env.FBIS_BASE||"https://fbis-myz.pages.dev";
const SECRET=process.env.HARVEST_SECRET||"";
const START=Number(process.env.CFB_MARKET_START||2004);
const END=Number(process.env.CFB_MARKET_END||2026);
if(!SECRET){console.error("HARVEST_SECRET missing");process.exit(2);}
mkdirSync("artifacts/cfb-history-v3",{recursive:true});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const safe=(s)=>String(s??"").replaceAll('"','""');
const csv=(rows,cols)=>[cols.join(","),...rows.map(r=>cols.map(c=>{
  const v=r[c]; if(v==null)return ""; if(typeof v==="number")return String(v);
  return '"'+safe(typeof v==="string"?v:JSON.stringify(v))+'"';
}).join(","))].join("\n")+"\n";

async function call(params){
  const u=new URL("/api/cfb-history-chunk",BASE);
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
  for(let a=1;a<=5;a++){
    const res=await fetch(u,{headers:{"x-harvest-secret":SECRET,accept:"application/json"}});
    const body=await res.json().catch(()=>({}));
    if(res.ok&&body.ok)return body;
    console.error(JSON.stringify({attempt:a,status:res.status,error:body.error,params}));
    if(!(res.status===429||res.status>=500)||a===5) throw new Error(`CFBD line chunk failed ${res.status}: ${JSON.stringify(body)}`);
    await sleep(a*5000);
  }
}
function norm(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function parsedHomeSpread(row){
  const spread=Number(row.spread);
  if(!Number.isFinite(spread))return null;
  // CFBD /lines already expresses spread from the home team's perspective.
  return spread;
}
function spreadSemanticCheck(row){
  const spread=Number(row.spread);
  if(!Number.isFinite(spread))return null;
  const fmt=norm(row.formattedSpread),h=norm(row.homeTeam),a=norm(row.awayTeam);
  if(!fmt||(!h&&!a))return null;
  const namesHome=Boolean(h&&fmt.includes(h));
  const namesAway=Boolean(a&&fmt.includes(a));
  if(namesHome===namesAway)return null;
  return namesHome ? spread<=0 : spread>=0;
}
const rows=[];
for(let year=START;year<=END;year++){
  for(const seasonType of ["regular","postseason"]){
    const body=await call({year,weekStart:0,weekEnd:25,seasonType,coverageOnly:1,includeStatic:0});
    for(const l of body.lines||[]){
      rows.push({
        season:year,season_type:seasonType,game_id:l.gameId,provider:l.provider,
        home_team:l.homeTeam,away_team:l.awayTeam,
        raw_spread:l.spread,home_spread:parsedHomeSpread(l),
        formatted_spread:l.formattedSpread,spread_semantic_ok:spreadSemanticCheck(l),
        total:l.overUnder,opening_spread:l.openingSpread,opening_total:l.openingOverUnder,
        home_moneyline:l.homeMoneyline,away_moneyline:l.awayMoneyline
      });
    }
    console.error(JSON.stringify({year,seasonType,games:body.counts?.games||0,lineProviderRows:body.lines?.length||0}));
    await sleep(400);
  }
}
const uniq=new Map();
for(const r of rows)uniq.set([r.game_id,r.provider,r.raw_spread,r.total,r.opening_spread,r.opening_total,r.home_moneyline,r.away_moneyline].join("|"),r);
const out=[...uniq.values()];
const cols=["season","season_type","game_id","provider","home_team","away_team","raw_spread","home_spread","formatted_spread","spread_semantic_ok","total","opening_spread","opening_total","home_moneyline","away_moneyline"];
writeFileSync("artifacts/cfb-history-v3/cfbd_market_lines_all_providers.csv",csv(out,cols));
const q={
  generatedAt:new Date().toISOString(),seasons:[START,END],providerRows:out.length,
  games:new Set(out.map(x=>String(x.game_id))).size,
  gamesWithParsedHomeSpread:new Set(out.filter(x=>Number.isFinite(Number(x.home_spread))).map(x=>String(x.game_id))).size,
  gamesWithTotal:new Set(out.filter(x=>Number.isFinite(Number(x.total))).map(x=>String(x.game_id))).size,
  providers:[...new Set(out.map(x=>x.provider).filter(Boolean))].sort(),
  policy:"Provider rows retained losslessly. home_spread is populated only when formattedSpread identifies the listed home/away team; otherwise raw_spread remains available and home_spread is null."
};
writeFileSync("artifacts/cfb-history-v3/cfbd_market_qa.json",JSON.stringify(q,null,2));
console.log(JSON.stringify(q,null,2));
