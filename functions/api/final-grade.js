import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { gradeSnapshotPopulationAgainstFinals } from "../lib/projLedger.js";
import { excludeSnapshotsForGame, gradeSnapshotsForGame } from "../lib/store.js";

const SPORTS = new Set(["mlb","nfl","cfb","cbb","nba","wnba","nhl"]);

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
    const exclusionsRaw=Array.isArray(body?.exclusions)?body.exclusions:null;
    const forceExclude=body?.forceExclude===true;
    if(exclusionsRaw){
      if(exclusionsRaw.length>50) return json({ok:false,error:"too-many-exclusions"},400);
      let excluded=0;
      let failed=0;
      const failedGameIds=[];
      for(const row of exclusionsRaw){
        const gameId=String(row?.gameId||"").trim();
        const reason=String(row?.reason||"INVALID_HISTORICAL_SNAPSHOT").trim();
        if(!gameId){
          failed+=1;
          failedGameIds.push(gameId);
          continue;
        }
        const res=await excludeSnapshotsForGame(context.env,{gameId,reason,excludedAt:new Date().toISOString(),forceExclude});
        if(res?.ok) excluded+=1;
        else {
          failed+=1;
          failedGameIds.push(gameId);
        }
      }
      return json({
        ok:failed===0,
        mode:"learning-exclusions",
        sport,
        date,
        excluded,
        failed,
        failedGameIds,
        at:new Date().toISOString(),
      },failed===0?200:503);
    }

    const directRaw=Array.isArray(body?.grades)?body.grades:null;
    const forceCorrect=body?.forceCorrect===true;
    if(directRaw){
      if(directRaw.length>25) return json({ok:false,error:"too-many-grades"},400);
      const grades=directRaw.map((row)=>({
        gameId:String(row?.gameId||"").trim(),
        actualHome:finiteScore(row?.actualHome),
        actualAway:finiteScore(row?.actualAway),
        f5ActualHome:finiteScore(row?.f5ActualHome),
        f5ActualAway:finiteScore(row?.f5ActualAway),
      }));
      if(grades.some((g)=>!g.gameId||g.actualHome==null||g.actualAway==null)){
        return json({ok:false,error:"invalid-direct-grade"},400);
      }
      let matched=0;
      let failed=0;
      const failedGameIds=[];
      for(const g of grades){
        const res=await gradeSnapshotsForGame(context.env,{
          ...g,
          gradedAt:new Date().toISOString(),
          forceCorrect,
        });
        if(res?.ok) matched+=1;
        else {
          failed+=1;
          failedGameIds.push(g.gameId);
        }
      }
      return json({
        ok:failed===0,
        mode:forceCorrect?"direct-corrected-grades":"direct-verified-grades",
        source:String(body?.source||"trusted-scoreboard-reconciled-runner"),
        sport,
        date,
        accepted:grades.length,
        matched,
        failed,
        failedGameIds,
        at:new Date().toISOString(),
      },failed===0?200:503);
    }

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
