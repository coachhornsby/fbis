/**
 * Public, read-only football research rankings. Only approved sport D1
 * bindings are used; never consumes paid odds or alters a wager decision.
 * NFL samples full regulation game paths on request from frozen snapshots;
 * CFB reads immutable previously executed drive V2 samples.
 */
import {simulateNflFullGameResearch} from "../lib/nflFullGameSimulationResearch.js";
import {rankFootballDistribution,sortFootballRankings} from "../lib/footballSimulationRankings.js";
const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
 "content-type":"application/json; charset=utf-8",
 "cache-control":"public, max-age=0, s-maxage=180",
 "x-content-type-options":"nosniff",
}});
const isTime=s=>typeof s==="string"&&Number.isFinite(Date.parse(s));
export async function loadFootballRankingGames(env,{
 sport="nfl",now=new Date().toISOString(),weekOffset=0,
}={}){
 if(!["nfl","cfb"].includes(sport))throw Error("INVALID_SPORT");
 if(!isTime(now)||!Number.isInteger(weekOffset)||weekOffset<0||weekOffset>2)
   throw Error("INVALID_TIME_WINDOW");
 const db=sport==="nfl"?env?.NFL_DB:env?.CFB_DB;
 if(!db?.prepare)throw Error("SPORT_DB_UNBOUND");
 const after=new Date(Date.parse(now)+weekOffset*7*86400000).toISOString();
 const before=new Date(Date.parse(after)+7*86400000).toISOString();
 if(sport==="nfl"){
  const result=await db.prepare(
    `SELECT g.id gameId,g.start kickoff,g.home_name home,g.away_name away,
      g.home_abbr homeAbbr,g.away_abbr awayAbbr,
      p.id snapshotId,p.model_version baselineVersion,
      p.frozen_at sourceFrozenAt,p.proj_home projectedHome,
      p.proj_away projectedAway
     FROM games g JOIN prediction_snapshots p ON p.game_id=g.id
     WHERE g.sport='nfl' AND g.start>? AND g.start<=?
       AND p.sport='nfl' AND p.model_version='v1.2'
       AND p.proj_home IS NOT NULL AND p.proj_away IS NOT NULL
       AND p.frozen_at<=? AND p.frozen_at<g.start
       AND p.id=(
         SELECT p2.id FROM prediction_snapshots p2
         WHERE p2.game_id=g.id AND p2.sport='nfl'
           AND p2.model_version='v1.2'
           AND p2.proj_home IS NOT NULL AND p2.proj_away IS NOT NULL
           AND p2.frozen_at<=? AND p2.frozen_at<g.start
         ORDER BY p2.frozen_at DESC,p2.id DESC LIMIT 1
       )
     ORDER BY g.start,g.id LIMIT 30`
  ).bind(after,before,now,now).all();
  if(!Array.isArray(result?.results))throw Error("NFL_DB_READ_FAILED");
  return {games:result.results,after,before,source:"NFL_DB"};
 }
 const result=await db.prepare(
  `SELECT g.id gameId,g.start kickoff,g.home_name home,g.away_name away,
     g.home_abbr homeAbbr,g.away_abbr awayAbbr,
     r.id runId,r.frozen_at simulationFrozenAt,
     r.generated_at generatedAt,r.iterations,
     r.simulator_version baselineVersion,
     r.baseline_json baselineJson,r.distributions_json distributionsJson
   FROM games g JOIN cfb_drive_shadow_runs r ON r.game_id=g.id
   WHERE g.sport='cfb' AND g.start>? AND g.start<=?
     AND r.frozen_at<g.start AND r.frozen_at<=?
     AND r.authority='RESEARCH_SHADOW_ONLY' AND r.can_authorize_wager=0
     AND NOT EXISTS (
       SELECT 1 FROM cfb_drive_shadow_runs older
       WHERE older.game_id=r.game_id AND
         (older.frozen_at<r.frozen_at OR
         (older.frozen_at=r.frozen_at AND older.id<r.id))
     )
   ORDER BY g.start,g.id LIMIT 120`
 ).bind(after,before,now).all();
 if(!Array.isArray(result?.results))throw Error("CFB_DB_READ_FAILED");
 return {games:result.results,after,before,source:"CFB_DB"};
}
export function buildFootballRankings(rows,options){
 const sport=options.sport;
 const exclusions={};const cards=[];
 for(const game of rows||[]){
  try{
   let simulation,sourceFrozenAt,simulationFrozenAt,method,calibrationStatus,modelVersion;
   if(sport==="nfl"){
     simulation=simulateNflFullGameResearch({
       gameId:game.gameId,kickoff:game.kickoff,sourceFrozenAt:game.sourceFrozenAt,
       projectedHome:game.projectedHome,projectedAway:game.projectedAway,
       iterations:5000,modelVersion:game.baselineVersion,
     });
     sourceFrozenAt=game.sourceFrozenAt;
     simulationFrozenAt=game.sourceFrozenAt;
     method=simulation.method;
     modelVersion=simulation.modelId;
     calibrationStatus="NOT_VALIDATED";
   }else{
     const base=JSON.parse(game.baselineJson);
     simulation={distributions:JSON.parse(game.distributionsJson),iterations:game.iterations};
     sourceFrozenAt=base.sourceFrozenAt;
     simulationFrozenAt=game.simulationFrozenAt;
     method="CFBD_VERIFIED_DRIVE_RESAMPLING";
     modelVersion=game.baselineVersion;
     calibrationStatus="INSUFFICIENT_VERIFIED_PROSPECTIVE_GRADES";
   }
   const d=simulation.distributions;
   // Legacy 2026 frozen CFB runs stored P(home leads) and P(tie); away
   // lead complement is exact because these are exhaustive same-game draws.
   if(sport==="cfb" && d.home_regulation_lead && d.regulation_tie &&
       !d.away_regulation_lead){
     const x=1-d.home_regulation_lead.mean-d.regulation_tie.mean;
     d.away_regulation_lead={mean:Math.max(0,Math.min(1,x))};
   }
   cards.push(rankFootballDistribution({
     sport,gameId:game.gameId,kickoff:game.kickoff,
     home:game.home,away:game.away,
     homeAbbr:game.homeAbbr,awayAbbr:game.awayAbbr,
     iterations:simulation.iterations,modelVersion,
     sourceFrozenAt,simulationFrozenAt,
     distributions:d,method,calibrationStatus,
     source:options.source,generatedAt:game.generatedAt||null,
   }));
  }catch(e){
   const code=String(e?.message||"SIMULATION_NOT_AVAILABLE").slice(0,80);
   exclusions[code]=(exclusions[code]||0)+1;
  }
 }
 return {cards,exclusions};
}
export async function onRequestGet({request,env}){
 const url=new URL(request.url),sport=url.searchParams.get("sport")||"nfl";
 const week=Number(url.searchParams.get("week")||0);
 const sort=url.searchParams.get("sort")||"winPct";
 const direction=url.searchParams.get("direction")||"desc";
 if(!["nfl","cfb"].includes(sport)||
     !Number.isInteger(week)||week<0||week>2||
     !["winPct","blowoutPct","total","margin","kickoff","tiePct"].includes(sort)||
     !["asc","desc"].includes(direction))
   return send({ok:false,error:"INVALID_RANKINGS_FILTER"},400);
 const cache=typeof caches==="undefined"?null:caches.default;
 const cacheKey=new Request(url.toString());
 if(cache){const hit=await cache.match(cacheKey);if(hit)return hit;}
 try{
  const now=new Date().toISOString();
  const result=await loadFootballRankingGames(env,{sport,now,weekOffset:week});
  const built=buildFootballRankings(result.games,{sport,source:result.source});
  const cards=sortFootballRankings(built.cards,sort,direction).map((r,i)=>({...r,rank:i+1}));
  const data={ok:true,mode:"RESEARCH_ONLY",sport,week,window:{
   after:result.after,before:result.before},generatedAt:now,
   modelFamilies:{nfl:"PARAMETRIC_REGULATION_DRIVE_PATHS",cfb:"VERIFIED_DRIVE_RESAMPLING"},
   blowoutDefinition:"REGULATION_MARGIN_AT_LEAST_14_POINTS",
   results:cards,exclusions:built.exclusions,eligible:result.games.length,displayed:cards.length,
   calibrated:false,canAuthorizeWager:false,changesProductionChampion:false,
   limitations:["NO_OVERTIME","NO_VALIDATED_WAGER_PROBABILITIES",
     sport==="nfl"?"NFL_DRIVE_PRIORS_NOT_EMPIRICALLY_CALIBRATED":"LEGACY_CFB_BLOWOUT_METRICS_MAY_BE_UNAVAILABLE"],
  };
  const res=send(data);
  if(cache)await cache.put(cacheKey,res.clone());
  return res;
 }catch(err){
  return send({ok:false,error:String(err?.message||"SIMULATION_NOT_AVAILABLE").slice(0,100),
   canAuthorizeWager:false},503);
 }
}
