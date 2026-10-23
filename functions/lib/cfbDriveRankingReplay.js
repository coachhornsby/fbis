/**
 * Backfill CFB 14-point outcome frequencies from the EXACT original frozen
 * 1,000 draw game paths, preserving immutable raw run receipts. Fail closed
 * if evidence, seed, scores or old probabilities differ after replay.
 */
import {simulateCfbDriveShadowV2,CFB_DRIVE_SIM_ID} from "./cfbDriveSimulationV2.js";
function dbFrom(env){if(!env?.CFB_DB?.prepare)throw Error("CFB_DB_UNBOUND");return env.CFB_DB;}
const validId=id=>/^[a-zA-Z0-9:._|-]{1,220}$/.test(String(id||""));
const distKeys=["home_regulation_lead","away_regulation_lead","regulation_tie",
  "home_blowout_14","away_blowout_14"];
export async function pendingCfbRankingReplays(env,{limit=70}={}){
 const db=dbFrom(env);
 const res=await db.prepare(
  `SELECT r.game_id gameId, r.id runId FROM cfb_drive_shadow_runs r
    LEFT JOIN cfb_drive_rankings_enrichment e ON e.run_id=r.id
    WHERE r.simulator_version=? AND r.authority='RESEARCH_SHADOW_ONLY'
      AND r.can_authorize_wager=0 AND e.run_id IS NULL
    ORDER BY r.kickoff ASC,r.game_id ASC LIMIT ?`
 ).bind(CFB_DRIVE_SIM_ID,Math.min(100,Math.max(1,Number(limit)||70))).all();
 if(!Array.isArray(res?.results))throw Error("CFB_RANKING_REPLAY_LIST_FAILED");
 return {ok:true,source:"CFB_DB",pending:res.results,canAuthorizeWager:false};
}
export async function replayCfbRankingMetrics(env,{runId,now=new Date().toISOString()}={}){
 const db=dbFrom(env);
 if(!validId(runId))throw Error("INVALID_CFB_REPLAY_RUN_ID");
 const r=await db.prepare(
  `SELECT id,game_id gameId,snapshot_id snapshotId,source_model sourceModel,
    frozen_at frozenAt,kickoff,simulator_version simulatorVersion,
    evidence_fingerprint evidenceFingerprint,seed,iterations,
    training_games trainingGames,training_drives trainingDrives,
    baseline_json baselineJson,distributions_json distributionsJson,
    authority,can_authorize_wager wagerAuthority
    FROM cfb_drive_shadow_runs WHERE id=?`
 ).bind(runId).first();
 if(!r||r.simulatorVersion!==CFB_DRIVE_SIM_ID||
    r.authority!=="RESEARCH_SHADOW_ONLY"||r.wagerAuthority!==0 ||
    Date.parse(r.frozenAt)>=Date.parse(r.kickoff))
   throw Error("CFB_RANKING_ORIGINAL_RUN_NOT_VERIFIED");
 const existing=await db.prepare(
  "SELECT ranking_metrics_json FROM cfb_drive_rankings_enrichment WHERE run_id=?"
 ).bind(runId).first();
 if(existing)return {ok:true,status:"ALREADY_REPLAYED",runId,metrics:JSON.parse(existing.ranking_metrics_json),
   canAuthorizeWager:false};
 const baseline=JSON.parse(r.baselineJson),original=JSON.parse(r.distributionsJson);
 if(![baseline.home,baseline.away].every(x=>typeof x==="number"&&Number.isFinite(x)))throw Error("CFB_RANKING_BASELINE_INVALID");
 const source=await db.prepare(
  `SELECT game_id gameId,source,source_fingerprint sourceFingerprint,
   source_observed_at observedAt,kickoff,graded_at gradedAt,model_version modelVersion,
   projected_home projectedHome,projected_away projectedAway,
   drives_json drivesJson,verified_against_game verified,period_scope periodScope
   FROM cfb_drive_verified_games WHERE source_observed_at<?
   ORDER BY kickoff DESC LIMIT 350`
 ).bind(r.frozenAt).all();
 if(!Array.isArray(source?.results))throw Error("CFB_REPLAY_SOURCE_UNAVAILABLE");
 const history=source.results.map(g=>({
  ...g,drives:JSON.parse(g.drivesJson),officialScoreMatched:g.verified===1,
  regulationOnly:g.periodScope==="REGULATION_ONLY",
 }));
 const result=simulateCfbDriveShadowV2({
  gameId:r.gameId,snapshotId:r.snapshotId,frozenAt:r.frozenAt,kickoff:r.kickoff,
  projectedHome:baseline.home,projectedAway:baseline.away,
  trainingGames:history,iterations:r.iterations,
 });
 if(result.seed!==r.seed||result.evidenceFingerprint!==r.evidenceFingerprint||
    result.trainingGames!==r.trainingGames||result.trainingDrives!==r.trainingDrives)
   throw Error("CFB_RANKING_REPLAY_EVIDENCE_MISMATCH");
 for(const metric of ["home_score","away_score","margin","total","home_regulation_lead","regulation_tie"]){
  if(Math.abs(result.distributions[metric].mean-original[metric].mean)>1e-10)
   throw Error("CFB_RANKING_REPLAY_DISTRIBUTION_MISMATCH");
 }
 const metrics=Object.fromEntries(distKeys.map(k=>[k,result.distributions[k]]));
 const write=await db.prepare(
  `INSERT OR IGNORE INTO cfb_drive_rankings_enrichment
    (run_id,source_simulator_version,original_seed,evidence_fingerprint,
     iterations,replayed_at,ranking_metrics_json,authority,can_authorize_wager)
    VALUES (?,?,?,?,?,?,?,'RESEARCH_SHADOW_ONLY',0)`
 ).bind(runId,CFB_DRIVE_SIM_ID,r.seed,r.evidenceFingerprint,r.iterations,
  now,JSON.stringify(metrics)).run();
 return {ok:true,status:Number(write?.meta?.changes)===1?"REPLAYED":"ALREADY_REPLAYED",
  gameId:r.gameId,runId,metrics,
  verifiedSameSeed:true,verifiedSameSource:true,verifiedOriginalScoreDistribution:true,
  mutationOriginalRun:false,canAuthorizeWager:false};
}
