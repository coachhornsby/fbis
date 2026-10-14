import { authorizeSoccerWorker, unauthorizedBody } from "../lib/soccerWorkerAuth.js";
import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";
import { soccerHistoryHealth } from "../lib/store.js";
import {
  buildSoccerProspectiveShadowRecords,
  persistSoccerProspectiveShadow,
} from "../lib/soccerProspectiveShadow.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},
  });
}
function ctDate(d=new Date()){
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(d);
}
function envForSlate(context){
  return{
    PARLAY_API_KEY:context.env.PARLAY_API_KEY,
    THEODDS_API_KEY:context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY:context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY:context.env.THERUNDOWN_API_KEY,
    DB:context.env.DB,
    ARCHIVE:context.env.ARCHIVE,
    caches:caches.default,
    parlayCacheOnly:true,
    palCacheOnly:true,
    cfbdScheduleFallback:false,
  };
}

async function snapshot(context,date,competition=null){
  const resolved=resolveSlateDate(date||ctDate(),{maxPast:0,maxFuture:3});
  if(!resolved.ok)return{ok:false,error:resolved.error};
  const snapshotAt=new Date().toISOString();
  const slate=await buildSlate("soccer",resolved.date,{...envForSlate(context),soccerProofCompetition:competition});
  let attempted=0,written=0,existing=0,eligibleGames=0;
  const skipped={},skippedDetails={},fixtures=[];
  for(const game of slate.games||[]){
    if(game?.status?.completed||game?.status?.live){
      skipped["not-pregame"]=(skipped["not-pregame"]||0)+1;
      continue;
    }
    const v2=game.soccerFbisV2, v31=game.soccerFbisV3;
    fixtures.push({eventId:String(game.id),competition:game.soccerLeague||game.league||null,
      home:game.home?.name,away:game.away?.name,kickoff:game.start,
      canonicalHistoryCount:v2?.provenance?.historyMatches??v2?.diagnostics?.historyMatches??null,
      homeHistoryCount:v2?.uncertainty?.homeHistoryGames??null,awayHistoryCount:v2?.uncertainty?.awayHistoryGames??null,
      v2MarketUsed:v2?.provenance?.marketUsed??null,v31MarketUsed:v31?.provenance?.marketUsed??null,
      postMatchTargetFeaturesUsed:v31?.provenance?.postMatchTargetFeaturesUsed??null,persistentStateUsed:v31?.provenance?.persistentStateUsed??null,
      v2Ok:v2?.ok===true,v2Reason:v2?.reason||null,v31Ok:v31?.ok===true,v31Reason:v31?.reason||null});
    const built=buildSoccerProspectiveShadowRecords(game,slate,{
      snapshotAt,
      collectorCodeSha:context.env.CF_PAGES_COMMIT_SHA||null,
    });
    if(!built.ok){
      skipped[built.reason]=(skipped[built.reason]||0)+1;
      if(built.detail){
        const storeError=built.reason==="v2-projection-unavailable"?soccerHistoryHealth()?.lastError:null;
        const detail=storeError?`${built.detail}|store-${String(storeError).slice(0,240)}`:built.detail;
        const key=`${built.reason}:${detail}`;
        skippedDetails[key]=(skippedDetails[key]||0)+1;
      }
      continue;
    }
    if(!built.rows.length){
      skipped["no-shadow-eligible-routes"]=(skipped["no-shadow-eligible-routes"]||0)+1;
      continue;
    }
    eligibleGames++;
    attempted+=built.rows.length;
    const persisted=await persistSoccerProspectiveShadow(context.env.DB,built.rows);
    if(!persisted.ok)return{ok:false,error:persisted.reason||"shadow-persist-failed",date:resolved.date};
    written+=persisted.written;
    existing+=persisted.existing;
  }
  return{
    ok:true,
    date:resolved.date,
    snapshotAt,
    slateGames:Number(slate.games?.length||0),
    eligibleGames,attempted,written,existing,skipped,skippedDetails,fixtures,
    lifecycle:"SHADOW",
    collectorCodeSha:context.env.CF_PAGES_COMMIT_SHA||null,
    publicProjectionRoutingChanged:false,
    persistentStateUsed:false,
    marketUsedInModel:false,
    researchOnly:true,
    canQualify:false,
    canAuthorize:false,
  };
}

async function summary(db,collectorCodeSha=null){
  const total=await db.prepare(`SELECT
    COUNT(*) n,
    COUNT(DISTINCT event_id) events,
    SUM(CASE WHEN market_history_available=1 THEN 1 ELSE 0 END) with_market,
    SUM(CASE WHEN research_only<>1 OR can_qualify<>0 OR can_authorize<>0 THEN 1 ELSE 0 END) governance_violations,
    MIN(snapshot_at) first_snapshot_at,
    MAX(snapshot_at) latest_snapshot_at
    FROM soccer_prospective_shadow`).first();
  const byRoute=(await db.prepare(`SELECT competition_key,market_family,COUNT(*) n,
    SUM(CASE WHEN market_history_available=1 THEN 1 ELSE 0 END) with_market,
    MAX(snapshot_at) latest_snapshot_at
    FROM soccer_prospective_shadow
    GROUP BY competition_key,market_family
    ORDER BY competition_key,market_family`).all())?.results||[];
  return{
    ok:true,lifecycle:"SHADOW",collectorCodeSha,
    rows:Number(total?.n||0),events:Number(total?.events||0),
    withMarket:Number(total?.with_market||0),
    governanceViolations:Number(total?.governance_violations||0),
    firstSnapshotAt:total?.first_snapshot_at||null,
    latestSnapshotAt:total?.latest_snapshot_at||null,
    byRoute,
    researchOnly:true,canQualify:false,canAuthorize:false,
  };
}

export async function onRequest(context){
  const auth=authorizeSoccerWorker(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
  if(!context.env?.DB?.prepare)return json({ok:false,error:"database-unavailable"},503);
  const url=new URL(context.request.url);
  const mode=String(url.searchParams.get("mode")||"summary").toLowerCase();
  try{
    if(mode==="summary")return json(await summary(context.env.DB,context.env.CF_PAGES_COMMIT_SHA||null));
    if(mode==="snapshot"){
      const competition=url.searchParams.get("competition");
      if(competition && !["ger.1","fra.1","esp.1"].includes(competition))return json({ok:false,error:"unsupported-proof-competition"},400);
      const result=await snapshot(context,url.searchParams.get("date"),competition);
      return json(result,result.ok?200:400);
    }
    return json({ok:false,error:"unsupported-mode"},400);
  }catch(err){
    return json({ok:false,error:"soccer-prospective-shadow-failed",detail:String(err?.message||err)},500);
  }
}
