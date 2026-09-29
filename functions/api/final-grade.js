import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { gradeSnapshotPopulationAgainstFinals } from "../lib/projLedger.js";

const SPORTS = new Set(["mlb","nfl","cfb","cbb","nba","nhl"]);

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
    },
  });
}

function finiteScore(v){
  if(v==null || v==="") return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}

function normalizeFinal(row={},sport,date){
  const homeScore=finiteScore(row?.home?.score ?? row?.actualHome);
  const awayScore=finiteScore(row?.away?.score ?? row?.actualAway);
  const completed =
    row?.status?.completed===true ||
    String(row?.status?.state||"").toLowerCase()==="post" ||
    /final/i.test(String(row?.status?.detail||""));
  const homeName=String(row?.home?.name||row?.homeName||"").trim();
  const awayName=String(row?.away?.name||row?.awayName||"").trim();
  if(!completed || homeScore==null || awayScore==null || !homeName || !awayName) return null;
  return {
    id:String(row?.id||row?.gameId||""),
    sport,
    date:String(row?.date||date||"").slice(0,10),
    start:row?.start||null,
    home:{
      name:homeName,
      abbr:row?.home?.abbr||row?.homeAbbr||null,
      score:homeScore,
      espnId:row?.home?.espnId||null,
    },
    away:{
      name:awayName,
      abbr:row?.away?.abbr||row?.awayAbbr||null,
      score:awayScore,
      espnId:row?.away?.espnId||null,
    },
    status:{completed:true,state:"post",detail:"Final"},
    f5Score:row?.f5Score||null,
  };
}

export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok) return json(unauthorizedBody(),401);
  try{
    const body=await context.request.json();
    const sport=String(body?.sport||"").toLowerCase();
    const date=String(body?.date||"").slice(0,10);
    if(!SPORTS.has(sport)) return json({ok:false,error:"unsupported-sport"},400);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ok:false,error:"invalid-date"},400);
    const raw=Array.isArray(body?.finals)?body.finals:[];
    if(raw.length>400) return json({ok:false,error:"too-many-finals"},400);
    const finals=raw.map((row)=>normalizeFinal(row,sport,date)).filter(Boolean);
    const requestedBatch=Number(body?.batchLimit);
    const batchLimit=Number.isFinite(requestedBatch)
      ? Math.max(1,Math.min(25,Math.trunc(requestedBatch)))
      : null;
    const result=await gradeSnapshotPopulationAgainstFinals(context.env,{
      sport,
      date,
      finals,
      gradedAt:new Date().toISOString(),
      maxWrites:batchLimit,
    });
    return json({
      ok:result.ok,
      source:String(body?.source||"trusted-scoreboard-push"),
      sport,
      date,
      received:raw.length,
      accepted:finals.length,
      ...result,
      at:new Date().toISOString(),
    },result.ok?200:503);
  }catch(err){
    return json({ok:false,error:String(err?.message||err)},400);
  }
}
