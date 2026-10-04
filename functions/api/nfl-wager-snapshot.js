import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}

function summarize(games=[]){
  let decisionGames=0,candidates=0,priced=0,passes=0,bets=0;
  const blockers={};
  for(const game of games){
    const d=game?.nflWagerDecision;
    if(!d?.ok){
      const key=d?.reason||"decision-unavailable";
      blockers[key]=(blockers[key]||0)+1;
      continue;
    }
    decisionGames+=1;
    for(const c of d.candidates||[]){
      candidates+=1;
      if(c.americanPrice!=null) priced+=1;
      if(c.decision==="BET") bets+=1; else passes+=1;
      for(const r of c.reasons||[]) blockers[r]=(blockers[r]||0)+1;
    }
  }
  return {games:games.length,decisionGames,candidates,pricedCandidates:priced,bets,passes,blockers};
}

export async function onRequest(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
  if(context.request.method!=="POST"&&context.request.method!=="GET")return json({ok:false,error:"method-not-allowed"},405);

  const url=new URL(context.request.url);
  const rawDate=url.searchParams.get("date")||"";
  const resolved=resolveSlateDate(rawDate,{maxPast:7,maxFuture:7});
  if(rawDate&&!resolved.ok)return json({ok:false,error:resolved.error},400);

  const env={
    PARLAY_API_KEY:context.env.PARLAY_API_KEY,
    THEODDS_API_KEY:context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY:context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY:context.env.THERUNDOWN_API_KEY,
    DB:context.env.DB,
    ARCHIVE:context.env.ARCHIVE,
    caches:caches.default,
    parlayCacheOnly:true,
    cfbdScheduleFallback:false,
  };

  try{
    const slate=await buildSlate("nfl",resolved.date,env);
    const summary=summarize(slate.games||[]);
    const inserted=Number(slate.nflWagerArchitecture?.decisionSnapshotsPersisted||0);
    return json({
      ok:true,
      sport:"nfl",
      date:slate.date||resolved.date,
      modelVersion:slate.modelVersion||null,
      architecture:slate.nflWagerArchitecture||null,
      ...summary,
      inserted,
      confidenceValidated:Boolean(slate.nflWagerArchitecture?.confidenceValidated),
      stakingValidated:Boolean(slate.nflWagerArchitecture?.stakingValidated),
    });
  }catch(err){
    return json({ok:false,error:"nfl-wager-snapshot-failed",detail:String(err?.message||err)},500);
  }
}
