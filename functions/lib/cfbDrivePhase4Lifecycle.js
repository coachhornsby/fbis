/**
 * Phase 4 CFB V2 lifecycle. Read-only pregame discovery, source-verified
 * postgame grading. Operator auth is enforced by the existing API entrypoint.
 * No CFBD/network access, primary DB fallback, champion or wager mutation.
 */
import {gradeCfbDriveShadow} from "./cfbDriveSimulationStore.js";

function dbFrom(env) {
  if(!env?.CFB_DB?.prepare)throw Error("CFB_DB_UNBOUND");
  return env.CFB_DB;
}
const ts=s=>typeof s==="string"&&s.trim()?Date.parse(s):NaN;
const validClock=s=>Number.isFinite(ts(s));
const bounded=n=>Math.min(60,Math.max(1,Number.isInteger(n)?n:30));

/** Pregame, pre-result, deterministic first-available game selection.
 * Only games without an existing V2 ledger receipt are offered.
 */
export async function eligibleCfbDriveProspectiveGames(env,{
 now=new Date().toISOString(),limit=30,horizonDays=7,
}={}){
 const db=dbFrom(env);
 if(!validClock(now))throw Error("INVALID_CLOCK");
 const days=Number.isInteger(horizonDays)?Math.min(10,Math.max(1,horizonDays)):7;
 const horizon=new Date(ts(now)+days*86400000).toISOString();
 const cap=bounded(limit);
 const result=await db.prepare(
  `SELECT e.id AS gameId,e.start AS kickoff,e.home_name AS home,e.away_name AS away,
          s.id AS sourceSnapshotId,s.frozen_at AS sourceFrozenAt
    FROM games e JOIN prediction_snapshots s ON s.game_id=e.id
    WHERE e.sport='cfb' AND e.start>? AND e.start<=?
      AND s.sport='cfb' AND s.model_version='CFB-FBIS-v2'
      AND s.projection_kind='FBIS' AND s.actual_home IS NULL
      AND s.actual_away IS NULL
      AND s.proj_home IS NOT NULL AND s.proj_away IS NOT NULL
      AND s.frozen_at<e.start AND s.frozen_at<=?
      AND s.id=(
         SELECT newest.id FROM prediction_snapshots newest
         WHERE newest.game_id=e.id AND newest.sport='cfb'
           AND newest.model_version='CFB-FBIS-v2'
           AND newest.projection_kind='FBIS' AND newest.actual_home IS NULL
           AND newest.actual_away IS NULL
           AND newest.proj_home IS NOT NULL AND newest.proj_away IS NOT NULL
           AND newest.frozen_at<e.start AND newest.frozen_at<=?
         ORDER BY newest.frozen_at DESC,newest.id DESC LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM cfb_drive_shadow_runs r
        WHERE r.game_id=e.id AND r.simulator_version='CFB-DRIVE-STATE-SHADOW-v2'
      )
    ORDER BY e.start ASC,e.id ASC LIMIT ?`
 ).bind(now,horizon,now,now,cap).all();
 if(!Array.isArray(result?.results))throw Error("CFB_ELIGIBLE_QUERY_FAILED");
 return {ok:true,mode:"prospective_eligible",asOf:now,through:horizon,
   games:result.results,eligible:result.results.length,
   source:"CFB_DB",canAuthorizeWager:false,providerRequests:0};
}

/** Only source-verified games with ungraded research receipts can be graded. */
export async function gradeReadyCfbDriveCohort(env,{
 now=new Date().toISOString(),limit=50,
}={}){
 const db=dbFrom(env);
 if(!validClock(now))throw Error("INVALID_CLOCK");
 const cap=bounded(limit);
 const result=await db.prepare(
  `SELECT DISTINCT r.game_id AS gameId
    FROM cfb_drive_shadow_runs r
    JOIN cfb_drive_verified_games v
      ON v.game_id=r.game_id
     AND v.verified_against_game=1
     AND v.period_scope='REGULATION_ONLY'
     AND v.source_observed_at>r.kickoff
    LEFT JOIN cfb_drive_shadow_grades g ON g.run_id=r.id
    WHERE r.authority='RESEARCH_SHADOW_ONLY'
      AND r.can_authorize_wager=0
      AND r.kickoff<?
      AND r.frozen_at<r.kickoff
      AND g.run_id IS NULL
    ORDER BY r.game_id LIMIT ?`
 ).bind(now,cap).all();
 if(!Array.isArray(result?.results))throw Error("CFB_GRADE_READY_QUERY_FAILED");
 const details=[];
 let graded=0;
 for(const row of result.results){
   const out=await gradeCfbDriveShadow(env,{gameId:row.gameId,now});
   if(!out.ok)throw Error("VERIFIED_CFB_GRADE_FAILED");
   graded+=out.graded||0;
   details.push({gameId:row.gameId,graded:out.graded||0});
 }
 return {ok:true,graded,eligibleGames:result.results.length,
   checked:details.length,details,source:"CFB_DB",
   providerRequests:0,canAuthorizeWager:false,
   changesProductionChampion:false};
}
