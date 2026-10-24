/** Point-in-time challenger grading from verified official completed-set outcomes only.
 * An immutable grade is inserted once per frozen forecast. No market data influence.
 */
const epoch=x=>Date.parse(x||'');
export function scoreTennisRankSnapshot(row){
 const fail=reason=>({ok:false,reason});
 const source=row.tour==='wta'?'WTA_OFFICIAL':row.tour==='atp'?'ATP_OFFICIAL':null;
 const prefix=row.tour==='wta'?'tennis/wta/official-results/raw/':
  row.tour==='atp'?'tennis/atp/official-results/raw/':null;
 if(!source||row.source!==source||row.completion_state!=='FINAL'||
    row.result_reason!=='OFFICIAL_COMPLETED_SETS'||!row.source_winner_id||
    !String(row.raw_artifact_key||'').startsWith(prefix))return fail('OFFICIAL_FINAL_EVIDENCE_MISSING');
 if(!Number.isFinite(epoch(row.forecast_at))||!Number.isFinite(epoch(row.event_start_time))||
    epoch(row.forecast_at)>=epoch(row.event_start_time)||!Number.isFinite(epoch(row.result_observed_at))||
    epoch(row.result_observed_at)<epoch(row.event_start_time))
   return fail('TEMPORAL_EVIDENCE_INVALID');
 if(row.player1_id!==row.match_player1_id||row.player2_id!==row.match_player2_id)
   return fail('PLAYER_IDENTITY_MISMATCH');
 const y=row.winner_id===row.player1_id?1:row.winner_id===row.player2_id?0:null;
 if(y===null)return fail('WINNER_IDENTITY_MISMATCH');
 const p=Number(row.p1_win);
 if(!(p>0&&p<1)||!Number.isFinite(p))return fail('INVALID_FROZEN_PROBABILITY');
 return {ok:true,actualP1:y,brier:(p-y)**2,
  logLoss:-(y*Math.log(p)+(1-y)*Math.log(1-p)),hit:Number((p>=.5?1:0)===y)};
}
export async function gradeTennisRankingChallenger(db,{now=new Date()}={}){
 if(!db?.prepare)throw Error('DB_REQUIRED');
 const query=await db.prepare(`SELECT r.*,m.source,m.completion_state,m.result_reason,
 m.raw_artifact_key,m.source_winner_id,m.winner_id,m.player1_id match_player1_id,
 m.player2_id match_player2_id,m.observed_at result_observed_at
 FROM tennis_inhouse_rank_challenger r
 JOIN tennis_official_matches m ON m.match_id=r.canonical_event_id
 LEFT JOIN tennis_inhouse_rank_grades g ON g.snapshot_id=r.snapshot_id
 WHERE g.snapshot_id IS NULL ORDER BY r.forecast_at ASC LIMIT 2000`).all();
 const blocked={};let written=0,eligible=0;
 for(const row of query.results||[]){
  const s=scoreTennisRankSnapshot(row);
  if(!s.ok){blocked[s.reason]=(blocked[s.reason]||0)+1;continue}
  eligible++;
  const result=await db.prepare(`INSERT OR IGNORE INTO tennis_inhouse_rank_grades(
  snapshot_id,canonical_event_id,tour,winner_id,result_raw_artifact_key,
  p1_win,actual_p1,brier,log_loss,hit,graded_at,can_authorize_wager)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`).bind(row.snapshot_id,row.canonical_event_id,row.tour,
   row.winner_id,row.raw_artifact_key,row.p1_win,s.actualP1,s.brier,s.logLoss,s.hit,now.toISOString()).run();
  written+=Number(result?.meta?.changes??result?.changes??0);
 }
 return {ok:true,asOf:now.toISOString(),reviewed:(query.results||[]).length,
  eligible,written,blocked,researchOnly:true,canAuthorizeWager:false};
}
export async function compareTennisChallengerToV2(db){
 const q=await db.prepare(`SELECT g.tour,g.canonical_event_id,g.actual_p1,g.p1_win rank_p1,
 d.pure_p1 v2_p1 FROM tennis_inhouse_rank_grades g
 JOIN tennis_v2_research_decisions d ON d.canonical_event_id=g.canonical_event_id
 AND d.snapshot_type='PURE_FIXTURE' AND d.pure_model_id='TENNIS-FBIS-v2-CONTEXT'
 AND julianday(d.decision_timestamp)<julianday(d.event_start_time)
 AND d.decision_timestamp=(SELECT MIN(x.decision_timestamp)
 FROM tennis_v2_research_decisions x WHERE x.canonical_event_id=d.canonical_event_id
 AND x.snapshot_type='PURE_FIXTURE' AND x.pure_model_id='TENNIS-FBIS-v2-CONTEXT')
 ORDER BY g.tour,g.canonical_event_id`).all();
 const grouped={atp:[],wta:[]};
 for(const row of q.results||[]){
  const p=Number(row.v2_p1);
  if(!(p>0&&p<1)||!grouped[row.tour])continue;
  grouped[row.tour].push(row);
 }
 const score=(p,y)=>({brier:(p-y)**2,logLoss:-(y*Math.log(p)+(1-y)*Math.log(1-p)),
  hit:Number((p>=.5?1:0)===y)});
 const mean=(a,k)=>a.length?a.reduce((s,r)=>s+r[k],0)/a.length:null;
 return {cohorts:Object.fromEntries(Object.entries(grouped).map(([tour,rows])=>{
  const metric=field=>{const a=rows.map(r=>score(Number(r[field]),r.actual_p1));
   return {brier:mean(a,'brier'),logLoss:mean(a,'logLoss'),accuracy:mean(a,'hit')}};
  return [tour,{pairedMatches:rows.length,challenger:metric('rank_p1'),v2:metric('v2_p1')}];
 })),pairedOnly:true,independentHoldoutNotEstablished:true,promotionReady:false,
 canAuthorizeWager:false};
}
