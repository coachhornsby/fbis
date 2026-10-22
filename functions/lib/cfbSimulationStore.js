/**
 * CFB-only simulation service.
 * No implicit DB fallback; never uses PRIMARY or TIER3_DB to store research.
 */
import {
  CFB_SIM_ID,CFB_SIM_CHAMPION_SOURCE,simulateCfbShadowV1
} from "./cfbSimulationV1.js";
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const time=s=>typeof s==="string"&&s?Date.parse(s):NaN;
const simId=snapshotId=>snapshotId+"|"+CFB_SIM_ID;
function requiredDb(env){
  if(!env?.CFB_DB?.prepare)throw new Error("CFB_DB_UNBOUND");
  return env.CFB_DB;
}
async function hasSchema(db){
  const r=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cfb_sim_shadow_runs'").first();
  const s=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cfb_sim_shadow_grades'").first();
  return !!r?.name&&!!s?.name;
}
async function sourceSnapshot(db,gameId,now){
  return db.prepare(
    `SELECT s.id snapshotId,s.game_id gameId,s.model_version modelVersion,
            s.proj_home projectedHome,s.proj_away projectedAway,s.frozen_at frozenAt,
            g.start kickoff,g.home_name homeName,g.away_name awayName
     FROM prediction_snapshots s JOIN games g ON g.id=s.game_id
     WHERE s.game_id=? AND s.sport='cfb' AND s.model_version=? AND
           s.projection_kind='FBIS' AND s.actual_home IS NULL AND
           s.actual_away IS NULL AND s.frozen_at<g.start AND g.start>? AND s.frozen_at<=?
           AND s.proj_home IS NOT NULL AND s.proj_away IS NOT NULL
     ORDER BY s.frozen_at DESC,s.id DESC LIMIT 1`
  ).bind(gameId,CFB_SIM_CHAMPION_SOURCE,now,now).first();
}
async function historical(db,cutoff,modelVersion){
  // SQL limits work; JS independently validates all temporal evidence.
  const result=await db.prepare(
    `SELECT s.id snapshotId,s.game_id gameId,s.model_version modelVersion,
          s.projection_kind projectionKind,s.frozen_at frozenAt,
          s.proj_home projectedHome,s.proj_away projectedAway,
          s.actual_home actualHome,s.actual_away actualAway,
          s.graded_at gradedAt,g.start kickoff
     FROM prediction_snapshots s JOIN games g ON g.id=s.game_id
     WHERE s.sport='cfb' AND s.model_version=? AND s.projection_kind='FBIS'
       AND s.graded_at IS NOT NULL AND s.graded_at<?
       AND g.start<? AND s.actual_home IS NOT NULL AND s.actual_away IS NOT NULL
       AND s.frozen_at<g.start
     ORDER BY s.graded_at DESC,s.frozen_at DESC LIMIT 7000`
  ).bind(modelVersion,cutoff,cutoff).all();
  if(!Array.isArray(result?.results))throw new Error("HISTORY_READ_FAILED");
  return result.results;
}
function cleanGameId(gameId) {
  const id=String(gameId||"");
  if(!/^[a-zA-Z0-9:._-]{1,80}$/.test(id))throw new Error("INVALID_GAME_ID");
  return id;
}
export async function freezeCfbShadowEvent(env,{gameId,now=new Date().toISOString(),iterations=5000}={}){
  const db=requiredDb(env),id=cleanGameId(gameId);
  if(!Number.isFinite(time(now)))throw new Error("INVALID_CLOCK");
  if(!(await hasSchema(db)))throw new Error("CFB_SIM_SCHEMA_NOT_INSTALLED");
  const source=await sourceSnapshot(db,id,now);
  if(!source || !(time(source.frozenAt)<time(source.kickoff) && time(now)<time(source.kickoff))) return {ok:false,reason:"NO_ELIGIBLE_CURRENT_PREGAME_SNAPSHOT",gameId:id};
  const existing=await db.prepare("SELECT id FROM cfb_sim_shadow_runs WHERE snapshot_id=? AND simulator_version=?").bind(source.snapshotId,CFB_SIM_ID).first();
  if(existing)return {ok:true,status:"ALREADY_FROZEN",runId:existing.id,gameId:id};
  const rows=await historical(db,source.frozenAt,source.modelVersion);
  const result=simulateCfbShadowV1({...source,historicalRows:rows,iterations});
  const runId=simId(source.snapshotId);
  const inserted=await db.prepare(
    `INSERT OR IGNORE INTO cfb_sim_shadow_runs (
      id,game_id,snapshot_id,champion_model_version,simulator_version,frozen_at,kickoff,
      training_count,training_fingerprint,seed,iterations,baseline_json,distributions_json,
      generated_at,authority,can_authorize_wager
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'RESEARCH_SHADOW_ONLY',0)`
  ).bind(runId,id,source.snapshotId,source.modelVersion,CFB_SIM_ID,
    source.frozenAt,source.kickoff,result.trainingCount,result.trainingEvidenceFingerprint,
    result.seed,result.iterations,JSON.stringify(result.baseline),
    JSON.stringify(result.distributions),now).run();
  return {ok:true,status:Number(inserted?.meta?.changes)===1?"FROZEN":"ALREADY_FROZEN",
    runId,gameId:id,sourceSnapshotId:source.snapshotId,sourceFrozenAt:source.frozenAt,
    trainingCount:result.trainingCount,trainingEvidenceFingerprint:result.trainingEvidenceFingerprint,
    simulation:result.distributions,modelAuthority:"RESEARCH_SHADOW_ONLY",
    canAuthorizeWager:false,noProviderCalls:true};
}
export async function gradeCfbShadowEvent(env,{gameId,now=new Date().toISOString()}={}){
  const db=requiredDb(env),id=cleanGameId(gameId);
  if(!(await hasSchema(db)))throw new Error("CFB_SIM_SCHEMA_NOT_INSTALLED");
  const records=(await db.prepare(
    `SELECT r.id runId,r.distributions_json distributions,s.actual_home actualHome,
        s.actual_away actualAway,s.graded_at settledAt,r.kickoff kickoff
       FROM cfb_sim_shadow_runs r JOIN prediction_snapshots s ON s.id=r.snapshot_id
       LEFT JOIN cfb_sim_shadow_grades v ON v.run_id=r.id
       WHERE r.game_id=? AND v.run_id IS NULL AND
         s.actual_home IS NOT NULL AND s.actual_away IS NOT NULL AND
         s.graded_at IS NOT NULL AND s.graded_at>=r.kickoff AND r.kickoff<?
       ORDER BY r.generated_at DESC LIMIT 12`
  ).bind(id,now).all())?.results||[];
  const saved=[];
  for(const row of records){
    if(![row.actualHome,row.actualAway].every(finite) ||
       !(Number.isFinite(time(row.settledAt))&&Number.isFinite(time(row.kickoff))&&time(row.settledAt)>=time(row.kickoff)) ||
       !Number.isFinite(time(now))||time(now)<time(row.settledAt))continue;
    let d;try{d=JSON.parse(row.distributions);}catch{throw new Error("INVALID_ARCHIVED_DISTRIBUTION");}
    const inside=(x,interval)=>Number(x>=interval.p10&&x<=interval.p90);
    const inside90=(x,interval)=>Number(x>=interval.p05&&x<=interval.p95);
    const inside50=(x,interval)=>Number(x>=interval.p25&&x<=interval.p75);
    const total=row.actualHome+row.actualAway,margin=row.actualHome-row.actualAway;
    const result=await db.prepare(
      `INSERT OR IGNORE INTO cfb_sim_shadow_grades (
        run_id,game_id,actual_home,actual_away,settled_at,score_mae,
        total_absolute_error,margin_absolute_error,inside_50_total,
        inside_80_total,inside_90_total,inside_80_margin,inside_90_margin,
        computed_at,authority)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'RESEARCH_SHADOW_ONLY')`
    ).bind(row.runId,id,row.actualHome,row.actualAway,row.settledAt,
      (Math.abs(row.actualHome-d.home_score.p50)+Math.abs(row.actualAway-d.away_score.p50))/2,
      Math.abs(total-d.total.p50),Math.abs(margin-d.margin.p50),
      inside50(total,d.total),inside(total,d.total),inside90(total,d.total),
      inside(margin,d.margin),inside90(margin,d.margin),now).run();
    if(Number(result?.meta?.changes)===1)saved.push(row.runId);
  }
  return {ok:true,gameId:id,graded:saved.length,runIds:saved,authority:"RESEARCH_SHADOW_ONLY"};
}
export async function cfbShadowReport(env,{limit=20}={}){
  const db=requiredDb(env);
  if(!(await hasSchema(db)))return {ok:false,reason:"CFB_SIM_SCHEMA_NOT_INSTALLED"};
  const max=Math.max(1,Math.min(50,Number(limit)||20));
  const rows=(await db.prepare(
    `SELECT r.id,r.game_id,r.snapshot_id,r.champion_model_version,r.frozen_at,r.kickoff,
          r.training_count,r.iterations,r.baseline_json,r.distributions_json,r.generated_at,
          g.settled_at,g.score_mae,g.total_absolute_error,g.margin_absolute_error,
          g.inside_80_total,g.inside_90_total,g.inside_80_margin,g.inside_90_margin
     FROM cfb_sim_shadow_runs r LEFT JOIN cfb_sim_shadow_grades g ON g.run_id=r.id
     ORDER BY r.generated_at DESC LIMIT ?`
  ).bind(max).all())?.results||[];
  return {ok:true,source:"CFB_DB",simulatorId:CFB_SIM_ID,count:rows.length,
    rows:rows.map(r=>({
      id:r.id,gameId:r.game_id,snapshotId:r.snapshot_id,
      championModelVersion:r.champion_model_version,frozenAt:r.frozen_at,kickoff:r.kickoff,
      trainingCount:r.training_count,iterations:r.iterations,
      baseline:JSON.parse(r.baseline_json),distributions:JSON.parse(r.distributions_json),
      generatedAt:r.generated_at,graded:r.settled_at!==null,
      grade:r.settled_at===null?null:{settledAt:r.settled_at,scoreMae:r.score_mae,
        totalAbsoluteError:r.total_absolute_error,marginAbsoluteError:r.margin_absolute_error,
        inside80Total:r.inside_80_total,inside90Total:r.inside_90_total,
        inside80Margin:r.inside_80_margin,inside90Margin:r.inside_90_margin}
    })),
    canQualify:false,canAuthorizeWager:false,changesProductionChampion:false};
}
