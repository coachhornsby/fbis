/** Operator-authenticated, read-only CFB prospective champion-versus-shadow audit. */
import {authorizeHarvest,unauthorizedBody} from "../lib/auth.js";
import {compareCfbProspectiveToFrozenChampion} from "../lib/cfbSdvProspectiveChampionAudit.js";
const reply=(x,status=200)=>new Response(JSON.stringify(x),{status,
 headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",
  "x-content-type-options":"nosniff"}});
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return reply(unauthorizedBody(auth.reason),403);
 if(!env?.CFB_DB?.prepare)return reply({ok:false,error:"CFB_DB_UNBOUND"},503);
 const asOf=new Date().toISOString();
 try{
  const records=await env.CFB_DB.prepare(
   "SELECT r.receipt_id receiptId,r.model_id modelId,"+
   "r.baseline_snapshot_id baselineSnapshotId,r.baseline_frozen_at baselineFrozenAt,"+
   "p.model_version championModelVersion,p.proj_home championHome,"+
   "p.proj_away championAway,r.projected_home challengerHome,"+
   "r.projected_away challengerAway,r.game_id gameId,"+
   "r.home_team_id homeTeamId,r.away_team_id awayTeamId,r.kickoff,"+
   "r.captured_at capturedAt,o.graded_at gradedAt,"+
   "o.source_observed_at observedAt,o.outcome_source_fingerprint sourceFingerprint,"+
   "o.actual_home actualHome,o.actual_away actualAway "+
   "FROM football_sdv_prospective_receipts r "+
   "JOIN football_sdv_prospective_grades o ON o.receipt_id=r.receipt_id "+
   "JOIN prediction_snapshots p ON p.id=r.baseline_snapshot_id "+
   "AND p.sport='cfb' AND p.game_id=r.game_id "+
   "WHERE r.sport='cfb' AND r.model_id='CFB-VERIFIED-DRIVE-MATCHUP-SHADOW-v0' "+
   "AND p.model_version='CFB-FBIS-v2' AND p.frozen_at<r.kickoff "+
   "AND p.frozen_at<=r.captured_at AND o.regulation_only=1 "+
   "AND r.captured_at<r.kickoff "+
   "ORDER BY r.kickoff DESC LIMIT 2000"
  ).all();
  if(!Array.isArray(records?.results))throw Error("CFB_PROSPECTIVE_PAIRS_UNAVAILABLE");
  return reply({ok:true,...compareCfbProspectiveToFrozenChampion(records.results,
   {asOf,minGames:30})});
 }catch(e){return reply({ok:false,error:String(e?.message||e).slice(0,140),
  canAuthorizeWager:false},503)}
}
