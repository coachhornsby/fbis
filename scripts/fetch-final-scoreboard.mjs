#!/usr/bin/env node
import { fetchResultsForReconcile } from "../functions/lib/slateEngineCore.js";

const sport=String(process.argv[2]||"").toLowerCase();
const date=String(process.argv[3]||"").slice(0,10);
const supported=new Set(["mlb","nfl","cfb","cbb","nba","nhl"]);
if(!supported.has(sport) || !/^\d{4}-\d{2}-\d{2}$/.test(date)){
  console.error("usage: node scripts/fetch-final-scoreboard.mjs <sport> <YYYY-MM-DD>");
  process.exit(2);
}

const cfbdApiKey=process.env.CFBD_API_KEY||process.env.COLLEGE_DATA_API_KEY||"";
try{
  const rows=await fetchResultsForReconcile(sport,date,{
    cfbdApiKey,
    preferCfbd:false,
  });
  const finals=(rows||[]).filter((g)=>
    g?.status?.completed===true &&
    Number.isFinite(Number(g?.home?.score)) &&
    Number.isFinite(Number(g?.away?.score))
  ).map((g)=>({...g,date,sport:g.sport||sport}));
  process.stdout.write(JSON.stringify({
    sport,
    date,
    source:"github-runner-scoreboard",
    finals,
    fetched:(rows||[]).length,
    completed:finals.length,
    generatedAt:new Date().toISOString(),
  }));
}catch(err){
  console.error(String(err?.stack||err?.message||err));
  process.exit(1);
}
