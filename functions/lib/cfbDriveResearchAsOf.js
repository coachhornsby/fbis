/**
 * CFB V2 as-of observation: permits a NEW research-only freeze today using
 * an earlier authentic CFB-FBIS-v2 baseline. Does not lie about the baseline
 * publication time or write into published prediction_snapshots.
 *
 * The original source forecast is identified in baseline_json. Simulation
 * training is strictly observed before the new research freeze timestamp.
 */
import {CFB_DRIVE_SIM_ID, simulateCfbDriveShadowV2} from "./cfbDriveSimulationV2.js";

function stamp(s) { return typeof s==="string" && s.trim()?Date.parse(s):NaN; }
function legitId(id) {return /^[a-zA-Z0-9:._-]{1,80}$/.test(String(id||""));}
export const CFB_RESEARCH_ASOF_MODE="NEW_RESEARCH_OBSERVATION_EARLIER_CHAMPION_BASELINE";

export async function freezeCfbDriveResearchAsOf(env,{
  gameId,now=new Date().toISOString(),iterations=1000,
}={}){
  const id=String(gameId||"");
  if(!legitId(id))throw Error("INVALID_GAME_ID");
  const db=env?.CFB_DB;
  if(!db?.prepare)throw Error("CFB_DB_UNBOUND");
  if(!Number.isFinite(stamp(now)))throw Error("INVALID_OBSERVATION_TIME");
  if(iterations!==1000)throw Error("RESEARCH_ITERATION_LIMIT");
  const schema=(await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cfb_drive_verified_games','cfb_drive_shadow_runs')"
  ).all())?.results||[];
  if(schema.length!==2)throw Error("CFB_DRIVE_SCHEMA_NOT_INSTALLED");
  const source=await db.prepare(
    `SELECT s.id AS sourceSnapshotId,s.game_id AS gameId,
      s.frozen_at AS sourceFrozenAt,s.proj_home AS projectedHome,
      s.proj_away AS projectedAway,g.start AS kickoff
      FROM prediction_snapshots s JOIN games g ON g.id=s.game_id
      WHERE s.game_id=? AND s.sport='cfb'
        AND s.model_version='CFB-FBIS-v2'
        AND s.projection_kind='FBIS'
        AND s.actual_home IS NULL AND s.actual_away IS NULL
        AND s.proj_home IS NOT NULL AND s.proj_away IS NOT NULL
        AND s.frozen_at < g.start AND g.start>? AND s.frozen_at<=?
      ORDER BY s.frozen_at DESC,s.id DESC LIMIT 1`
  ).bind(id,now,now).first();
  if(!source || !(stamp(source.sourceFrozenAt)<stamp(now) &&
    stamp(now)<stamp(source.kickoff)))return {ok:false,reason:"NO_VERIFIED_CURRENT_PREGAME_BASELINE",gameId:id};
  if(![source.projectedHome,source.projectedAway].every(x=>typeof x==="number"&&Number.isFinite(x)&&x>=0))
    throw Error("INVALID_PREGAME_BASELINE_SCORE");

  // A given game can have one immutable as-of research baseline on this day.
  const snapshotId=`RESEARCH_ASOF:${now.slice(0,10)}:${id}:${source.sourceSnapshotId}`;
  const runId=snapshotId+"|"+CFB_DRIVE_SIM_ID;
  const previous=await db.prepare("SELECT id,frozen_at,baseline_json FROM cfb_drive_shadow_runs WHERE id=?").bind(runId).first();
  if(previous)return {ok:true,status:"ALREADY_FROZEN",gameId:id,runId,asOf:previous.frozen_at,
    baselineLineage:JSON.parse(previous.baseline_json),noWagerAuthority:true};

  const training=(await db.prepare(
    `SELECT game_id gameId,source,source_fingerprint sourceFingerprint,
        source_observed_at observedAt,kickoff,graded_at gradedAt,
        model_version modelVersion,projected_home projectedHome,
        projected_away projectedAway,drives_json drivesJson,
        verified_against_game verified,period_scope periodScope
       FROM cfb_drive_verified_games WHERE source_observed_at<?
       ORDER BY kickoff DESC LIMIT 350`
  ).bind(now).all())?.results||[];
  const pool=training.map(row=>({
    gameId:row.gameId,source:row.source,sourceFingerprint:row.sourceFingerprint,
    observedAt:row.observedAt,kickoff:row.kickoff,gradedAt:row.gradedAt,
    modelVersion:row.modelVersion,projectedHome:row.projectedHome,
    projectedAway:row.projectedAway,drives:JSON.parse(row.drivesJson),
    officialScoreMatched:row.verified===1,
    regulationOnly:row.periodScope==="REGULATION_ONLY",
  }));
  const result=simulateCfbDriveShadowV2({
    gameId:id,snapshotId,frozenAt:now,kickoff:source.kickoff,
    projectedHome:source.projectedHome,projectedAway:source.projectedAway,
    trainingGames:pool,iterations,
  });
  const lineage={
    home:source.projectedHome,away:source.projectedAway,
    sourceModel:"CFB-FBIS-v2",sourceSnapshotId:source.sourceSnapshotId,
    sourceFrozenAt:source.sourceFrozenAt,researchFrozenAt:now,
    researchMode:CFB_RESEARCH_ASOF_MODE,
    baselineRecomputed:false,championSnapshotMutated:false,
    canAuthorizeWager:false,
  };
  const saved=await db.prepare(
    `INSERT OR IGNORE INTO cfb_drive_shadow_runs
       (id,game_id,snapshot_id,source_model,frozen_at,kickoff,generated_at,
        simulator_version,evidence_fingerprint,training_games,training_drives,
        iterations,seed,baseline_json,distributions_json,period_scope,authority,can_authorize_wager)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'REGULATION_ONLY','RESEARCH_SHADOW_ONLY',0)`
  ).bind(runId,id,snapshotId,"CFB-FBIS-v2",now,source.kickoff,now,
    CFB_DRIVE_SIM_ID,result.evidenceFingerprint,result.trainingGames,
    result.trainingDrives,result.iterations,result.seed,
    JSON.stringify(lineage),JSON.stringify(result.distributions)).run();
  return {ok:true,status:Number(saved?.meta?.changes)===1?"FROZEN":"ALREADY_FROZEN",
    gameId:id,runId,sourceSnapshotId:source.sourceSnapshotId,
    sourceFrozenAt:source.sourceFrozenAt,researchFrozenAt:now,
    trainingGames:result.trainingGames,trainingDrives:result.trainingDrives,
    iterations:result.iterations,distributions:result.distributions,
    researchMode:CFB_RESEARCH_ASOF_MODE,
    marketScope:"REGULATION_ONLY",ncaOvertimeMode:"NOT_MODELED",
    playerStatsMode:"NOT_MODELED",noWagerAuthority:true,
    changesProductionChampion:false};
}
