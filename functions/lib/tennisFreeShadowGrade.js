/** Immutable, independently sourced prospective Tennis shadow grade contract.
 * Settlement must be an official completed singles result with source receipt;
 * current schedule state, third-party scores or market settles never suffice.
 */
import {FREE_TENNIS_SHADOW_VERSION} from './tennisFreeShadowModel.js';
const timestamp=x=>Date.parse(String(x||''));
const shaPattern=/^[a-f0-9]{64}$/;
const p=x=>x!==null&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0&&Number(x)<1?Number(x):null;
const key=x=>String(x??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const validWin=(row,win)=>row?.winner_id===win&&(
  win===row.player1_id||win===row.player2_id);
const loss=(prob,y)=>({brier:(prob-y)**2,
 logLoss:-(y*Math.log(prob)+(1-y)*Math.log(1-prob)),
 correct:Number((prob>=.5?1:0)===y)});
export function validateVerifiedTennisOutcome(f,m){
 const fail=reason=>({ok:false,reason});
 if(f?.model_id!==FREE_TENNIS_SHADOW_VERSION||
  !shaPattern.test(String(f?.input_hash||''))||!f?.snapshot_id||
  !['atp','wta'].includes(f?.tour)||f.calibrated!==0||
  f.contract_trading_authorized!==0||f.decision_eligible!==0)
  return fail('FROZEN_RESEARCH_SNAPSHOT_INVALID');
 const forecast=timestamp(f.forecast_at),start=timestamp(f.event_start_time);
 if(!Number.isFinite(forecast)||!Number.isFinite(start)||forecast>=start)
  return fail('FORECAST_NOT_BEFORE_ORIGINAL_START');
 if(m?.match_id!==f.canonical_event_id||m.tour!==f.tour||
  m.source!==f.event_source||m.source!==f.tour.toUpperCase()+'_OFFICIAL'||
  m.player1_id!==f.player1_id||m.player2_id!==f.player2_id)
  return fail('CANONICAL_OFFICIAL_RESULT_IDENTITY_MISMATCH');
 if(m.completion_state!=='FINAL'||m.result_reason!=='OFFICIAL_COMPLETED_SETS'||
  !validWin(m,m.winner_id)||!m.source_winner_id||
  !m.score_text||!m.sets_json)return fail('OFFICIAL_COMPLETED_SETS_MISSING');
 const winnerExpected=m.winner_id===m.player1_id?m.source_player1_id:m.source_player2_id;
 if(String(winnerExpected)!==String(m.source_winner_id)||
  m.source_player1_id===m.source_player2_id)
  return fail('OFFICIAL_SOURCE_WINNER_ID_CONFLICT');
 const a=Number(m.player1_sets),b=Number(m.player2_sets);
 let sets;try{sets=JSON.parse(m.sets_json)}catch{return fail('OFFICIAL_SETS_JSON_INVALID')}
 if(!Array.isArray(sets)||sets.length<2||sets.length>5||a+b!==sets.length||
  !((a===2&&b<=1)||(b===2&&a<=1)||(a===3&&b<=2)||(b===3&&a<=2)))
  return fail('OFFICIAL_MATCH_SETS_INVALID');
 if(!String(m.raw_artifact_key||'').startsWith('tennis/'+f.tour+'/official-results/raw/'))
  return fail('OFFICIAL_RAW_RESULT_ARTIFACT_NOT_VERIFIED');
 let provenance;try{provenance=JSON.parse(m.provenance_json)}catch{return fail('OFFICIAL_PROVENANCE_JSON_MISSING')}
 const resultHash=String(provenance?.rawHash||'');
 if(!shaPattern.test(resultHash)||provenance.source!==m.source||
  provenance.rawKey!==m.raw_artifact_key||
  String(provenance?.sourceMatchId||'')!==String(m.source_match_id||''))
  return fail('OFFICIAL_PROVENANCE_HASH_SOURCE_CONFLICT');
 const observed=timestamp(m.observed_at);
 if(!Number.isFinite(observed)||observed<start||observed<=forecast)
  return fail('FINAL_RESULT_NOT_OBSERVED_AFTER_START');
 const pr=p(f.p1_win),pr2=p(f.p2_win);
 if(pr===null||pr2===null||Math.abs(pr+pr2-1)>1e-8)
  return fail('FORECAST_PROBABILITY_INVALID');
 return {ok:true,y:Number(m.winner_id===f.player1_id),
  observedAt:m.observed_at,resultHash,
  resultArtifactKey:m.raw_artifact_key};
}
function rankEvidence(f,baseline){
 if(!baseline||baseline.canonical_event_id!==f.canonical_event_id||
  baseline.player1_id!==f.player1_id||baseline.player2_id!==f.player2_id||
  baseline.tour!==f.tour||
  baseline.model_id!=='TENNIS-INHOUSE-RANK-BASELINE-v1'||
  baseline.can_authorize_wager!==0||
  timestamp(baseline.forecast_at)>=timestamp(f.event_start_time)||
  timestamp(baseline.forecast_at)<timestamp(f.event_observed_at)||
  timestamp(baseline.rank_observed1_at)>timestamp(baseline.forecast_at)||
  timestamp(baseline.rank_observed2_at)>timestamp(baseline.forecast_at)||
  timestamp(baseline.event_start_time)!==timestamp(f.event_start_time))
  return null;
 return p(baseline.p1_win)!==null?baseline:null;
}
function v2Evidence(f,baseline,official){
 if(!baseline||baseline.canonical_event_id!==f.canonical_event_id||
  baseline.tour!==f.tour||baseline.snapshot_type!=='PURE_FIXTURE'||
  baseline.pure_model_id!=='TENNIS-FBIS-v2-CONTEXT'||
  baseline.can_authorize_wager!==0||
  key(baseline.player1)!==key(official.p1_name)||
  key(baseline.player2)!==key(official.p2_name)||
  timestamp(baseline.decision_timestamp)>=timestamp(f.event_start_time)||
  timestamp(baseline.decision_timestamp)<timestamp(f.event_observed_at)||
  timestamp(baseline.event_start_time)!==timestamp(f.event_start_time))return null;
 return p(baseline.pure_p1)!==null?baseline:null;
}
export function gradeFrozenTennisSnapshot(f,official,{v2=[],ranking=[]}={}){
 const res=validateVerifiedTennisOutcome(f,official);
 if(!res.ok)return res;
 const earliestValid=(rows,fn,field)=>(rows||[]).filter(r=>fn(f,r,official))
  .sort((a,b)=>timestamp(a[field])-timestamp(b[field])||String(a.id||a.snapshot_id).localeCompare(String(b.id||b.snapshot_id)))[0]||null;
 const rank=earliestValid(ranking,rankEvidence,'forecast_at');
 const champion=earliestValid(v2,v2Evidence,'decision_timestamp');
 const challenger=loss(p(f.p1_win),res.y);
 const vr=champion?loss(p(champion.pure_p1),res.y):null;
 const rr=rank?loss(p(rank.p1_win),res.y):null;
 return {ok:true,modelId:FREE_TENNIS_SHADOW_VERSION,
  snapshotId:f.snapshot_id,eventId:f.canonical_event_id,tour:f.tour,
  player1Id:f.player1_id,player2Id:f.player2_id,winnerId:official.winner_id,
  y:res.y,forecastAt:f.forecast_at,eventStartTime:f.event_start_time,
  outcomeObservedAt:res.observedAt,officialResultRawKey:res.resultArtifactKey,
  officialResultHash:res.resultHash,challengerP1:p(f.p1_win),
  challenger,champion:champion?{snapshotId:champion.id,p1:p(champion.pure_p1),...vr}:null,
  ranking:rank?{snapshotId:rank.snapshot_id,p1:p(rank.p1_win),...rr}:null,
  fullyPaired:!!(champion&&rank),calibrated:false,promotionReady:false,
  contractTradingAuthorized:false};
}
export function summarizeFrozenTennisGrades(rows){
 const summarize=group=>{
  const avg=field=>group.length?group.reduce((a,x)=>a+Number(x[field]),0)/group.length:null;
  const paired=group.filter(x=>x.fully_paired===1);
  const pairedMean=field=>paired.length?paired.reduce((a,x)=>a+Number(x[field]),0)/paired.length:null;
  return {graded:group.length,fullyPaired:paired.length,
   challengerBrier:avg('challenger_brier'),
   challengerLogLoss:avg('challenger_log_loss'),
   challengerAccuracy:avg('challenger_correct'),
   paired:{n:paired.length,challengerBrier:pairedMean('challenger_brier'),
    v2Brier:pairedMean('v2_brier'),rankBrier:pairedMean('ranking_brier'),
    challengerLogLoss:pairedMean('challenger_log_loss'),
    v2LogLoss:pairedMean('v2_log_loss'),rankLogLoss:pairedMean('ranking_log_loss')}};
 };
 const cohorts={};
 for(const tour of ['atp','wta'])cohorts[tour]=summarize(rows.filter(r=>r.tour===tour));
 return {cohorts,total:summarize(rows),independentProspectiveOnly:true,
  readyForCalibration:false,promotionReady:false,
  contractTradingAuthorized:false};
}
