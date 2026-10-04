#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { cfbdGet } from "../functions/lib/collegeApi.js";
import { flattenGamesPlayersResponse, identifyGamePlayerRoles } from "../functions/lib/cfbPlayerIdentity.js";
import { projectCfbPlayerV1, flattenCfbPlayerProjectionRows } from "../functions/lib/cfbPlayerModel.js";
import fitted from "../data/models/cfb-fbis-v2-fitted-aa.js";

const seasons=(process.env.CFB_PLAYER_BT_SEASONS||"2023,2024,2025").split(",").map(Number).filter(Number.isFinite);
const MAX_WEEK=Number(process.env.CFB_PLAYER_BT_MAX_WEEK||15);
const env={CFBD_API_KEY:process.env.CFBD_API_KEY||""};
if(!env.CFBD_API_KEY) throw new Error("CFBD_API_KEY required");
mkdirSync("artifacts/cfb-player-backtest",{recursive:true});

const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function chunk(year,weekStart,weekEnd){
  const u=new URL("/api/cfb-history-chunk",BASE);
  for(const [k,v] of Object.entries({year,weekStart,weekEnd,seasonType:"regular",includeStatic:0,coverageOnly:0}))u.searchParams.set(k,String(v));
  let last=null;
  for(let a=1;a<=4;a++){
    const res=await fetch(u,{headers:{"x-harvest-secret":SECRET,accept:"application/json"}});
    const body=await res.json().catch(()=>({})); last={status:res.status,body};
    if(res.ok&&body.ok)return body;
    if(![429,500,502,503,504].includes(res.status))break;
    await sleep(a*800);
  }
  throw new Error(`chunk failed year=${year} weeks=${weekStart}-${weekEnd} status=${last?.status||0} error=${last?.body?.error||"unknown"}`);
}
