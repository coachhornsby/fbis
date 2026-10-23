/**
 * Operator-only, read-only CFB_DB bridge to matchup-conditioned v0 challenger.
 * Never changes the existing CFB v2 frozen receipts, backfills or wagering logic.
 */
import {resolveTeamExact} from "./teams.js";
import {simulateMatchupDriveShadow,selectMatchupDriveHistory} from "./footballPossessionMatchupResearch.js";
const t=x=>typeof x==="string"?Date.parse(x):NaN;
const canonical=name=>resolveTeamExact("cfb",{name})?.id||null;
export async function runCfbMatchupResearchFromVerifiedDb(env,{
 gameId,now=new Date().toISOString(),iterations=1000
}={}){
 const db=env?.CFB_DB;
 if(!db?.prepare)throw Error("CFB_DB_UNBOUND");
 if(!/^[A-Za-z0-9:._-]{1,80}$/.test(String(gameId||""))||
   !Number.isFinite(t(now))||iterations!==1000)throw Error("INVALID_CFB_MATCHUP_REQUEST");
 const target=await db.prepare(
  "SELECT s.id snapshotId,s.frozen_at sourceFrozenAt,s.proj_home projectedHome,"+
  "s.proj_away projectedAway,g.id gameId,g.start kickoff,g.home_name homeName,"+
  "g.away_name awayName FROM prediction_snapshots s JOIN games g ON g.id=s.game_id "+
  "WHERE g.sport='cfb' AND s.sport='cfb' AND s.game_id=? "+
  "AND s.model_version='CFB-FBIS-v2' AND s.projection_kind='FBIS' "+
  "AND s.proj_home IS NOT NULL AND s.proj_away IS NOT NULL "+
  "AND s.frozen_at<g.start AND s.frozen_at<=? AND g.start>? "+
  "ORDER BY s.frozen_at DESC,s.id DESC LIMIT 1"
 ).bind(String(gameId),now,now).first();
 if(!target)return {ok:false,reason:"NO_CURRENT_FROZEN_CFB_BASELINE",gameId};
 const homeTeamId=canonical(target.homeName),awayTeamId=canonical(target.awayName);
 if(!homeTeamId||!awayTeamId||homeTeamId===awayTeamId)
  return {ok:false,reason:"CANONICAL_TARGET_TEAM_IDENTITY_MISSING",gameId};
 const response=await db.prepare(
  "SELECT v.game_id gameId,v.source,v.source_fingerprint sourceFingerprint,"+
  "v.source_observed_at observedAt,v.kickoff,v.graded_at gradedAt,"+
  "v.projected_home projectedHome,v.projected_away projectedAway,"+
  "v.actual_home homeScore,v.actual_away awayScore,"+
  "v.drives_json drivesJson,v.verified_against_game verified,"+
  "v.period_scope periodScope,g.home_name homeName,g.away_name awayName "+
  "FROM cfb_drive_verified_games v JOIN games g ON g.id=v.game_id AND g.sport='cfb' "+
  "WHERE v.source_observed_at<? AND v.verified_against_game=1 "+
  "AND v.period_scope='REGULATION_ONLY' ORDER BY v.kickoff DESC LIMIT 350"
 ).bind(target.sourceFrozenAt).all();
 if(!Array.isArray(response?.results))throw Error("CFB_VERIFIED_DRIVE_READ_FAILED");
 let identityRejected=0,parseRejected=0;
 const games=[];
 for(const r of response.results){
  const h=canonical(r.homeName),a=canonical(r.awayName);
  if(!h||!a||h===a){identityRejected++;continue}
  let drives;
  try{drives=JSON.parse(r.drivesJson);if(!Array.isArray(drives))throw Error("bad")}catch{parseRejected++;continue}
  games.push({...r,homeTeamId:h,awayTeamId:a,drives,
   officialScoreMatched:r.verified===1,regulationOnly:r.periodScope==="REGULATION_ONLY"});
 }
 const history=selectMatchupDriveHistory(games,{
  sport:"cfb",targetGameId:String(gameId),frozenAt:target.sourceFrozenAt,
  homeTeamId,awayTeamId});
 if(!history.eligible)return {ok:false,reason:"INSUFFICIENT_MATCHUP_TEAM_DRIVE_HISTORY",
  gameId,trainingGames:history.trainingGames,trainingDrives:history.trainingDrives,
  coverage:history.coverage,identityRejected,parseRejected,
  canAuthorizeWager:false};
 const result=simulateMatchupDriveShadow({sport:"cfb",gameId:String(gameId),
  snapshotId:String(target.snapshotId),frozenAt:target.sourceFrozenAt,kickoff:target.kickoff,
  homeTeamId,awayTeamId,projectedHome:target.projectedHome,
  projectedAway:target.projectedAway,trainingGames:games,iterations});
 // Never serialize full raw training pool, personal data, or wager state.
 return {ok:true,mode:"RESEARCH_SHADOW_ONLY",sport:"cfb",
  gameId,modelId:result.modelId,modelVersion:result.modelVersion,
  home:target.homeName,away:target.awayName,
  homeTeamId,awayTeamId,sourceSnapshotId:target.snapshotId,
  frozenAt:target.sourceFrozenAt,kickoff:target.kickoff,
  sourceDb:"CFB_DB",trainingGames:result.trainingGames,
  trainingDrives:result.trainingDrives,coverage:result.coverage,
  iterations:result.iterations,seed:result.seed,
  evidenceFingerprint:result.evidenceFingerprint,
  distributions:result.distributions,identityRejected,parseRejected,
  calibrationStatus:"NOT_VALIDATED",canAuthorizeWager:false,
  canQualify:false,changesProductionChampion:false};
}
