/** Operator-only research matchup using actual available-at-request SDV drive evidence. */
import {authorizeHarvest,unauthorizedBody} from "../lib/auth.js";
import {resolveTeamExact} from "../lib/teams.js";
import {simulateMatchupDriveShadow,selectMatchupDriveHistory} from "../lib/footballPossessionMatchupResearch.js";
import {simulateNflVerifiedDriveTransitionShadow} from "../lib/nflSdvVerifiedTransitionResearch.js";
const send=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{
 "content-type":"application/json","cache-control":"no-store"}});
const time=s=>typeof s==="string"?Date.parse(s):NaN;
export async function querySdvMatchupFromSportDb(env,{sport,gameId,now=new Date().toISOString(),variant="standard"}={}){
 if(!["nfl","cfb"].includes(sport)||!/^[A-Za-z0-9:._-]{1,120}$/.test(String(gameId||""))||
    !Number.isFinite(time(now))||!["standard","nfl-sdv-v03"].includes(variant)||
    (variant==="nfl-sdv-v03"&&sport!=="nfl"))throw Error("INVALID_RESEARCH_SCOPE");
 const db=sport==="nfl"?env?.NFL_DB:env?.CFB_DB;
 if(!db?.prepare)throw Error("SPORT_DB_UNBOUND");
 const version=sport==="nfl"?"v1.2":"CFB-FBIS-v2";
 const target=await db.prepare(
  "SELECT p.id snapshotId,p.frozen_at sourceFrozenAt,p.proj_home projectedHome,"+
  "p.proj_away projectedAway,g.id gameId,g.start kickoff,g.home_name homeName,"+
  "g.away_name awayName,g.home_abbr homeAbbr,g.away_abbr awayAbbr "+
  "FROM prediction_snapshots p JOIN games g ON g.id=p.game_id "+
  "WHERE p.sport=? AND g.sport=? AND p.game_id=? AND p.model_version=? "+
  "AND p.frozen_at<g.start AND p.frozen_at<=? AND g.start>? "+
  "AND p.proj_home IS NOT NULL AND p.proj_away IS NOT NULL "+
  "ORDER BY p.frozen_at DESC,p.id DESC LIMIT 1"
 ).bind(sport,sport,gameId,version,now,now).first();
 if(!target)return {ok:false,reason:"NO_ELIGIBLE_FROZEN_BASELINE",sport,gameId};
 const home=resolveTeamExact(sport,{name:target.homeName,abbr:target.homeAbbr});
 const away=resolveTeamExact(sport,{name:target.awayName,abbr:target.awayAbbr});
 if(!home||!away||home.id===away.id)
   return {ok:false,reason:"CANONICAL_TEAM_IDENTITY_MISSING",sport,gameId};
 const archived=await db.prepare(
  "SELECT game_id gameId,season,home_team_id homeTeamId,away_team_id awayTeamId,"+
  "kickoff,graded_at gradedAt,source_observed_at observedAt,source_fingerprint sourceFingerprint,"+
  "source_model source,score_home homeScore,score_away awayScore,drives_json drivesJson "+
  "FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY game_id "+
  "ORDER BY source_observed_at DESC,source_fingerprint DESC) sourceRank "+
  "FROM football_sdv_verified_games WHERE sport=? AND source_observed_at<? AND kickoff<? "+
  "AND evidence_class='POSTGAME_RECONSTRUCTED' AND prospective=0 "+
  "AND can_authorize_wager=0) WHERE sourceRank=1 ORDER BY kickoff DESC LIMIT ?"
 ).bind(sport,now,now,sport==="nfl"?350:700).all();
 if(!Array.isArray(archived?.results))throw Error("SDV_HISTORY_READ_FAILED");
 const training=[],excluded={};
 for(const row of archived.results){
  try{const drives=JSON.parse(row.drivesJson);
   if(!Array.isArray(drives))throw Error("INVALID_DRIVES");
   training.push({...row,drives,regulationOnly:true,officialScoreMatched:true});
  }catch(e){const reason=String(e.message||e);excluded[reason]=(excluded[reason]||0)+1}
 }
 const cutoff=selectMatchupDriveHistory(training,{sport,targetGameId:String(gameId),
  frozenAt:now,homeTeamId:home.id,awayTeamId:away.id});
 if(!cutoff.eligible)return {ok:false,reason:"INSUFFICIENT_AVAILABLE_SDV_MATCHUP_DRIVES",
  sport,gameId,trainingGames:cutoff.trainingGames,trainingDrives:cutoff.trainingDrives,
  coverage:cutoff.coverage,excluded,canAuthorizeWager:false};
 let result;
 try{
  const input={sport,gameId:String(gameId),snapshotId:String(target.snapshotId),
   frozenAt:now,kickoff:target.kickoff,homeTeamId:home.id,awayTeamId:away.id,
   projectedHome:target.projectedHome,projectedAway:target.projectedAway,
   trainingGames:training};
  result=variant==="nfl-sdv-v03"?
   simulateNflVerifiedDriveTransitionShadow({...input,iterations:250}):
   simulateMatchupDriveShadow({...input,iterations:150});
 }catch(error){
  const reason=String(error?.message||"RESEARCH_SIMULATION_INELIGIBLE");
  if(variant==="nfl-sdv-v03"&&/^NFL_TRANSITION_/.test(reason))
   return {ok:false,sport,gameId,variant,reason,canQualify:false,canAuthorizeWager:false};
  throw error;
 }
 return {ok:true,mode:"RESEARCH_SHADOW_ONLY",sport,gameId,variant,
  home:target.homeName,away:target.awayName,kickoff:target.kickoff,
  modelId:result.modelId,modelVersion:result.modelVersion,sourceSnapshotId:target.snapshotId,
  baselineFrozenAt:target.sourceFrozenAt,researchAsOf:now,
  historyMode:"AVAILABLE_AT_RESEARCH_CLOCK",sourceDb:sport==="nfl"?"NFL_DB":"CFB_DB",
  sourceAssetFamily:"SDV_NFLVERSE_OR_ESPN_CFB_PBP",
  homeTeamId:home.id,awayTeamId:away.id,
  coverage:result.coverage,evidenceFingerprint:result.evidenceFingerprint,trainingGames:result.trainingGames,
  trainingDrives:result.trainingDrives,iterations:result.iterations,
  distributions:result.distributions,
  timeEvidence:result.timeEvidence||null,
  fieldTransitionMode:result.fieldTransitionMode||null,
  officialDurationDrives:result.officialDurationDrives||null,
  linkedNextFieldDrives:result.linkedNextFieldDrives||null,
  prospectiveQualification:false,calibrationStatus:"NOT_VALIDATED",
  canQualify:false,canAuthorizeWager:false,changesProductionChampion:false};
}
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return send(unauthorizedBody(auth.reason),403);
 const u=new URL(request.url);
 try{const result=await querySdvMatchupFromSportDb(env,{
  sport:u.searchParams.get("sport"),gameId:u.searchParams.get("gameId"),
  variant:u.searchParams.get("variant")||"standard"});
  return send(result,result.ok?200:422);
 }catch(e){return send({ok:false,error:String(e.message||e).slice(0,100),
  canAuthorizeWager:false},503)}
}
