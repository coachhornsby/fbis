import { CFB_DRIVE_SIM_ID, normalizeCfbdDriveGame,
  simulateCfbDriveShadowV2 } from "./cfbDriveSimulationV2.js";

/** All writes and reads stay within the existing CFB_DB binding. */
const when=v=>typeof v==="string"&&v?Date.parse(v):NaN;
const num=x=>typeof x==="number"&&Number.isFinite(x);
function cfbDb(env){if(!env?.CFB_DB?.prepare)throw Error("CFB_DB_UNBOUND");return env.CFB_DB;}
function id(x){const s=String(x||"");if(!/^[a-zA-Z0-9:._-]{1,80}$/.test(s))throw Error("INVALID_CFB_GAME_ID");return s;}
async function verifySchema(db){
 const rows=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cfb_drive_verified_games','cfb_drive_shadow_runs','cfb_drive_shadow_grades')").all())?.results||[];
 if(rows.length!==3)throw Error("CFB_DRIVE_SCHEMA_NOT_INSTALLED");
}
function providerScore(r,key){
 const names=key==="home"?["homePoints","home_points","homeScore"]:["awayPoints","away_points","awayScore"];
 for(const n of names){if(r[n]!==null&&r[n]!==undefined&&Number.isInteger(Number(r[n]))&&Number(r[n])>=0)return Number(r[n]);}
 return null;
}
/**
 * Called only by the quota-gated, authorized existing CFBD morning harvester.
 * Provider response is accompanied by completed game results from SAME fetch.
 * Does not accept arbitrary public/user-provided simulation histories.
 */
export async function ingestCfbDriveBatch(env,{finals=[],drives=[],observedAt=new Date().toISOString()}={}){
 const db=cfbDb(env);await verifySchema(db);
 if(!Number.isFinite(when(observedAt)))throw Error("INVALID_PROVIDER_OBSERVATION_CLOCK");
 if(!Array.isArray(finals)||!Array.isArray(drives))throw Error("INVALID_CFBD_BATCH");
 if(finals.length>120||drives.length>3600)throw Error("DRIVE_BATCH_TOO_LARGE");
 const byGame=new Map();
 for(const d of drives){
  const k=String(d?.gameId||"");
  if(!byGame.has(k))byGame.set(k,[]);
  byGame.get(k).push(d);
 }
 let inserted=0,existing=0;
 const rejected={};
 const examples=[];
 const eligibleIds=new Set();
 for(const game of finals){
  const gid=String(game?.id??game?.gameId??"");
  if(!/^[0-9]{5,12}$/.test(gid)||eligibleIds.has(gid))continue;
  eligibleIds.add(gid);
  const rows=byGame.get(gid)||[];
  let reason=null;
  const home=providerScore(game,"home"),away=providerScore(game,"away");
  if(home===null||away===null||rows.length<12)reason="MISSING_PROVIDER_FINAL_OR_DRIVES";
  const dbGame=reason?null:await db.prepare("SELECT id,start,home_name,away_name FROM games WHERE id=? AND sport='cfb'").bind(gid).first();
  if(!reason&&!dbGame?.start)reason="MISSING_CANONICAL_GAME";
  let source=null;
  if(!reason){
   source=await db.prepare(
    `SELECT id,proj_home AS projectedHome,proj_away AS projectedAway,
       frozen_at AS frozenAt
      FROM prediction_snapshots WHERE game_id=? AND sport='cfb'
        AND model_version='CFB-FBIS-v2' AND projection_kind='FBIS'
        AND frozen_at < ? AND proj_home IS NOT NULL AND proj_away IS NOT NULL
      ORDER BY frozen_at DESC,id DESC LIMIT 1`
   ).bind(gid,dbGame.start).first();
   if(!source)reason="NO_FROZEN_CFB_V2_BASELINE";
  }
  let verified=null;
  if(!reason){
   try{
    verified=normalizeCfbdDriveGame({gameId:gid,drives:rows,homeScore:home,awayScore:away,
      kickoff:dbGame.start,gradedAt:observedAt,observedAt,
      projectedHome:source.projectedHome,projectedAway:source.projectedAway});
   }catch(err){reason=String(err.message||err);}
  }
  if(reason){
   rejected[reason]=(rejected[reason]||0)+1;
   if(examples.length<8)examples.push({gameId:gid,reason});
   continue;
  }
  const result=await db.prepare(
   `INSERT OR IGNORE INTO cfb_drive_verified_games
    (game_id,source,source_fingerprint,source_observed_at,kickoff,graded_at,
     model_version,projected_home,projected_away,actual_home,actual_away,
     drive_count,drives_json,period_scope,verified_against_game,authority,can_authorize_wager)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'REGULATION_ONLY',1,'RESEARCH_SHADOW_ONLY',0)`
  ).bind(gid,"CFBD_DRIVES",verified.sourceFingerprint,observedAt,
    dbGame.start,observedAt,"CFB-FBIS-v2",
    source.projectedHome,source.projectedAway,home,away,
    verified.drives.length,JSON.stringify(verified.drives)).run();
  if(Number(result?.meta?.changes)===1)inserted++;else{
   existing++;
   const prior=await db.prepare("SELECT source_fingerprint FROM cfb_drive_verified_games WHERE game_id=?").bind(gid).first();
   if(prior?.source_fingerprint!==verified.sourceFingerprint){
    rejected.IMMUTABLE_SOURCE_CORRECTION_REQUIRED=(rejected.IMMUTABLE_SOURCE_CORRECTION_REQUIRED||0)+1;
   }
  }
 }
 return {ok:true,source:"CFBD_DRIVES",inserted,existing,rejected,examples,providedFinals:finals.length,
   providedDrives:drives.length,noPrimaryWrites:true,noModelPromotion:true};
}
async function frozenSource(db,gameId,now){
 return db.prepare(
  `SELECT s.id snapshotId,s.game_id gameId,s.model_version modelVersion,
      s.proj_home projectedHome,s.proj_away projectedAway,s.frozen_at frozenAt,
      g.start kickoff
    FROM prediction_snapshots s JOIN games g ON g.id=s.game_id
    WHERE s.game_id=? AND s.sport='cfb' AND s.model_version='CFB-FBIS-v2'
     AND s.projection_kind='FBIS' AND s.actual_home IS NULL AND s.actual_away IS NULL
     AND s.frozen_at<g.start AND g.start>? AND s.frozen_at<=?
    ORDER BY s.frozen_at DESC,s.id DESC LIMIT 1`
 ).bind(gameId,now,now).first();
}
async function trainingFor(db,frozenAt){
 const res=await db.prepare(
  `SELECT game_id gameId,source source,source_fingerprint sourceFingerprint,
   source_observed_at observedAt,kickoff,graded_at gradedAt,
   model_version modelVersion,projected_home projectedHome,
   projected_away projectedAway,drives_json drivesJson,
   verified_against_game verified,period_scope periodScope
   FROM cfb_drive_verified_games
   WHERE source_observed_at<? ORDER BY kickoff DESC LIMIT 350`
 ).bind(frozenAt).all();
 return (res?.results||[]).map(g=>({
  ...g,drives:JSON.parse(g.drivesJson),officialScoreMatched:g.verified===1,
  regulationOnly:g.periodScope==="REGULATION_ONLY",
 }));
}
export async function freezeCfbDriveShadow(env,{
 gameId,now=new Date().toISOString(),iterations=1000,
}={}){
 const db=cfbDb(env),gid=id(gameId);await verifySchema(db);
 if(!Number.isFinite(when(now)))throw Error("INVALID_CLOCK");
 const target=await frozenSource(db,gid,now);
 if(!target||!(when(target.frozenAt)<when(target.kickoff)&&when(now)<when(target.kickoff)))
   return {ok:false,reason:"NO_ELIGIBLE_CURRENT_PREGAME_SNAPSHOT",gameId:gid};
 const runId=target.snapshotId+"|"+CFB_DRIVE_SIM_ID;
 const present=await db.prepare("SELECT id FROM cfb_drive_shadow_runs WHERE id=?").bind(runId).first();
 if(present)return {ok:true,status:"ALREADY_FROZEN",gameId:gid,runId};
 const training=await trainingFor(db,target.frozenAt);
 const result=simulateCfbDriveShadowV2({...target,trainingGames:training,iterations});
 const record=await db.prepare(
  `INSERT OR IGNORE INTO cfb_drive_shadow_runs
    (id,game_id,snapshot_id,source_model,frozen_at,kickoff,generated_at,simulator_version,
    evidence_fingerprint,training_games,training_drives,iterations,seed,baseline_json,distributions_json,
    period_scope,authority,can_authorize_wager)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'REGULATION_ONLY','RESEARCH_SHADOW_ONLY',0)`
 ).bind(runId,gid,target.snapshotId,"CFB-FBIS-v2",
  target.frozenAt,target.kickoff,now,CFB_DRIVE_SIM_ID,result.evidenceFingerprint,
  result.trainingGames,result.trainingDrives,result.iterations,result.seed,
  JSON.stringify({home:target.projectedHome,away:target.projectedAway}),
  JSON.stringify(result.distributions)).run();
 return {ok:true,status:Number(record.meta?.changes)===1?"FROZEN":"ALREADY_FROZEN",
  gameId:gid,runId,simulatorId:CFB_DRIVE_SIM_ID,
  trainingGames:result.trainingGames,trainingDrives:result.trainingDrives,
  sourceSnapshot:target.snapshotId,distributions:result.distributions,
  marketScope:"REGULATION_ONLY",noWagerAuthority:true};
}
const cover=(q,value,lo,hi)=>Number(value>=q[lo]&&value<=q[hi]);
export async function gradeCfbDriveShadow(env,{
 gameId,now=new Date().toISOString(),
}={}){
 const db=cfbDb(env),gid=id(gameId);await verifySchema(db);
 const source=await db.prepare(
  "SELECT source_fingerprint,actual_home,actual_away,source_observed_at FROM cfb_drive_verified_games WHERE game_id=? AND verified_against_game=1"
 ).bind(gid).first();
 if(!source)return {ok:false,reason:"REGULATION_FINAL_SOURCE_NOT_VERIFIED",gameId:gid};
 const rows=(await db.prepare(
  `SELECT r.id,r.distributions_json FROM cfb_drive_shadow_runs r
   LEFT JOIN cfb_drive_shadow_grades g ON g.run_id=r.id
   WHERE r.game_id=? AND g.run_id IS NULL LIMIT 15`
 ).bind(gid).all())?.results||[];
 let inserted=0;
 for(const r of rows){
  const dist=JSON.parse(r.distributions_json);
  const total=source.actual_home+source.actual_away,margin=source.actual_home-source.actual_away;
  const q=dist.total,m=dist.margin;
  if(!q||!m)throw Error("INVALID_DISTRIBUTION_EVIDENCE");
  const saved=await db.prepare(
   `INSERT OR IGNORE INTO cfb_drive_shadow_grades
   (run_id,game_id,source_fingerprint,score_home,score_away,source_observed_at,
    total_mae,margin_mae,total_50_covered,total_80_covered,total_90_covered,
    margin_50_covered,margin_80_covered,margin_90_covered,created_at,authority)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'RESEARCH_SHADOW_ONLY')`
  ).bind(r.id,gid,source.source_fingerprint,source.actual_home,source.actual_away,
   source.source_observed_at,Math.abs(total-q.p50),Math.abs(margin-m.p50),
   cover(q,total,"p25","p75"),cover(q,total,"p10","p90"),cover(q,total,"p05","p95"),
   cover(m,margin,"p25","p75"),cover(m,margin,"p10","p90"),cover(m,margin,"p05","p95"),now).run();
  inserted+=Number(saved.meta?.changes)||0;
 }
 return {ok:true,gameId:gid,graded:inserted,authority:"RESEARCH_SHADOW_ONLY"};
}
export async function cfbDriveResearchStatus(env){
 const db=cfbDb(env);await verifySchema(db);
 const r=await db.prepare(
  `SELECT (SELECT COUNT(*) FROM cfb_drive_verified_games) source_games,
    (SELECT COALESCE(SUM(drive_count),0) FROM cfb_drive_verified_games) source_drives,
    (SELECT COUNT(*) FROM cfb_drive_shadow_runs) runs,
    (SELECT COUNT(*) FROM cfb_drive_shadow_grades) grades`
 ).first();
 return {ok:true,source:"CFB_DB",simulator:CFB_DRIVE_SIM_ID,
   sourceGames:r?.source_games||0,sourceDrives:r?.source_drives||0,
   runs:r?.runs||0,grades:r?.grades||0,
   trainingReady:(r?.source_games||0)>=20&&(r?.source_drives||0)>=300,
   limitations:["REGULATION_ONLY","NO_NCAA_OVERTIME","NO_PLAYER_PROPS","NO_WAGER_AUTHORITY"]};
}
