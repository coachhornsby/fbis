/** Cross-D1 immutable prospective grade capture.
 * Source authority: official result/paired frozen model rows from PRIMARY.
 * Research receipt authority: immutable challenger+grades on TENNIS_DB.
 * Never settles from unverified status or external market data.
 */
import {gradeFrozenTennisSnapshot,summarizeFrozenTennisGrades}
 from './tennisFreeShadowGrade.js';
import {FREE_TENNIS_SHADOW_VERSION} from './tennisFreeShadowModel.js';
const sha=async s=>[...new Uint8Array(await crypto.subtle.digest(
 'SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function inspectTennisFreeGrades(db){
 if(!db?.prepare)throw Error('TENNIS_DB_UNBOUND');
 const rows=(await db.prepare(`SELECT tour,fully_paired,challenger_brier,
   challenger_log_loss,challenger_correct,v2_brier,v2_log_loss,
   ranking_brier,ranking_log_loss
 FROM tennis_free_shadow_grades WHERE model_id=?
 ORDER BY graded_at LIMIT 2000`).bind(FREE_TENNIS_SHADOW_VERSION).all()).results||[];
 if(rows.length>=2000)throw Error('PROSPECTIVE_AUDIT_READ_LIMIT');
 return {ok:true,...summarizeFrozenTennisGrades(rows)};
}
export async function captureTennisFreeGrades(env,{now=new Date(),limit=75}={}){
 if(!env?.TENNIS_DB?.prepare||!env?.DB?.prepare||!Number.isFinite(+now))
  throw Error('CROSS_DATABASE_EVIDENCE_REQUIRED');
 if(env.TENNIS_FREE_SHADOW_ENABLED!=='true')
  throw Error('SHADOW_RESEARCH_DISABLED');
 const at=now.toISOString(),until=at;
 const candidates=(await env.TENNIS_DB.prepare(`SELECT f.*
 FROM tennis_free_shadow_forecasts f
 LEFT JOIN tennis_free_shadow_grades g ON g.forecast_snapshot_id=f.snapshot_id
 WHERE g.grade_id IS NULL AND f.forecast_at<? AND f.event_start_time<?
 ORDER BY f.event_start_time,f.snapshot_id LIMIT ?`)
  .bind(until,until,Math.max(1,Math.min(100,limit))).all()).results||[];
 const out={ok:true,asOf:at,examined:candidates.length,
  graded:0,fullyPairedNew:0,blocked:{},researchOnly:true,
  promotionReady:false,contractTradingAuthorized:false};
 const blocked=key=>out.blocked[key]=(out.blocked[key]||0)+1;
 for(const f of candidates){
  let official,champion,rank;
  try{
   official=await env.DB.prepare(`SELECT m.*,a.canonical_name p1_name,
   b.canonical_name p2_name FROM tennis_official_matches m
   LEFT JOIN tennis_players a ON a.fbis_player_id=m.player1_id
   LEFT JOIN tennis_players b ON b.fbis_player_id=m.player2_id
   WHERE m.match_id=?`).bind(f.canonical_event_id).first();
   const cr=(await env.DB.prepare(`SELECT id,canonical_event_id,tour,
    player1,player2,snapshot_type,pure_model_id,pure_p1,
    can_authorize_wager,decision_timestamp,event_start_time,context_json
    FROM tennis_v2_research_decisions
    WHERE canonical_event_id=? AND snapshot_type='PURE_FIXTURE'
    ORDER BY decision_timestamp ASC,id ASC LIMIT 120`)
    .bind(f.canonical_event_id).all()).results||[];
   champion=cr;
   const rr=(await env.DB.prepare(`SELECT snapshot_id,canonical_event_id,tour,
    player1_id,player2_id,model_id,p1_win,can_authorize_wager,
    rank_observed1_at,rank_observed2_at,forecast_at,event_start_time
    FROM tennis_inhouse_rank_challenger
    WHERE canonical_event_id=? ORDER BY forecast_at ASC,snapshot_id ASC LIMIT 120`)
    .bind(f.canonical_event_id).all()).results||[];
   rank=rr;
  }catch(e){blocked('PRIMARY_RESULT_OR_BASELINE_READ_UNAVAILABLE');continue}
  const grade=gradeFrozenTennisSnapshot(f,official,{v2:champion,ranking:rank});
  if(!grade.ok){blocked(grade.reason);continue}
  const context=JSON.stringify(grade),id=await sha([
   grade.snapshotId,grade.officialResultHash,grade.winnerId,grade.modelId
  ].join('|'));
  try{
   const res=await env.TENNIS_DB.prepare(`INSERT OR IGNORE INTO tennis_free_shadow_grades(
    grade_id,forecast_snapshot_id,canonical_event_id,tour,model_id,
    player1_id,player2_id,outcome_winner_id,outcome_p1,
    forecast_at,event_start_time,outcome_observed_at,official_result_raw_key,
    official_result_hash,challenger_p1,challenger_brier,challenger_log_loss,
    challenger_correct,v2_snapshot_id,v2_p1,v2_brier,v2_log_loss,
    ranking_snapshot_id,ranking_p1,ranking_brier,ranking_log_loss,
    fully_paired,grade_context_json,graded_at,calibrated,promotion_ready,
    contract_trading_authorized)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0)`)
    .bind(id,grade.snapshotId,grade.eventId,grade.tour,grade.modelId,
     grade.player1Id,grade.player2Id,grade.winnerId,grade.y,
     grade.forecastAt,grade.eventStartTime,grade.outcomeObservedAt,
     grade.officialResultRawKey,grade.officialResultHash,grade.challengerP1,
     grade.challenger.brier,grade.challenger.logLoss,grade.challenger.correct,
     grade.champion?.snapshotId||null,grade.champion?.p1??null,
     grade.champion?.brier??null,grade.champion?.logLoss??null,
     grade.ranking?.snapshotId||null,grade.ranking?.p1??null,
     grade.ranking?.brier??null,grade.ranking?.logLoss??null,
     Number(grade.fullyPaired),context,at).run();
   if(Number(res?.meta?.changes??res?.changes??0)>0){
    out.graded++;if(grade.fullyPaired)out.fullyPairedNew++;
   }
  }catch(e){blocked('IMMUTABLE_GRADE_INSERT_UNAVAILABLE');continue}
 }
 return {...out,readback:await inspectTennisFreeGrades(env.TENNIS_DB)};
}
