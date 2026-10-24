/** Self-calculated baseline from already-stored, point-in-time official ranks.
 * No Sackmann profiles, Elo mirrors, market prices, or model outputs used.
 * External source terms for rankings still require review for betting use.
 */
import {proveTennisEvent} from './tennisEventIntegrity.js';
export const TENNIS_INHOUSE_RANK_VERSION='TENNIS-INHOUSE-RANK-BASELINE-v1';
const epoch=v=>Date.parse(v||'');
const iso=v=>new Date(v).toISOString();
const rank=v=>{
 if(v==null||String(v).trim()==='')return null;
 const n=Number(v);
 return Number.isInteger(n)&&n>=1&&n<=5000?n:null;
};
export function inhouseRankProbability(r1,r2,{exponent=.5}={}){
 const a=rank(r1),b=rank(r2);
 if(a==null||b==null||exponent!==.5)return null;
 // Fixed for all future predictions. The 0.5 coefficient was selected after\n // exploratory comparison on 30 WTA matches; those 30 are NOT an independent holdout.
 const p=1/(1+Math.exp(-exponent*Math.log(b/a)));
 return Number.isFinite(p)&&p>0&&p<1?p:null;
}
export function validateRankForecast(event,one,two,{now=new Date(),maxRankAgeDays=21}={}){
 const fail=reason=>({ok:false,reason});
 const start=epoch(event?.event_start_time),forecast=+now;
 if(!Number.isFinite(start)||start<=forecast||start>forecast+72*3600000)
  return fail('UNVERIFIED_UPCOMING_EVENT_WINDOW');
 if(!['WTA_OFFICIAL','ATP_OFFICIAL'].includes(event.source)||
  !['wta','atp'].includes(event.tour)||
  event.source!==event.tour.toUpperCase()+'_OFFICIAL'||
  !event.player1_id||!event.player2_id||
  event.player1_id===event.player2_id)return fail('OFFICIAL_EVENT_OR_IDENTITY_INVALID');
 const inputs=[{observation:one,id:event.player1_id},{observation:two,id:event.player2_id}];
 for(const {observation:o,id} of inputs){
  if(!o||String(o.fbis_player_id)!==String(id)||
    String(o.tour)!==event.tour||o.source!==event.source||!o.observation_id)
   return fail('OFFICIAL_RANK_IDENTITY_PROVENANCE_MISSING');
  const stamp=epoch(o.observed_at),date=epoch(o.ranking_date);
  if(!Number.isFinite(stamp)||!Number.isFinite(date)||stamp>forecast||date>forecast||
     stamp>=start||date>=start||forecast-stamp>maxRankAgeDays*86400000)
   return fail('RANK_NOT_OBSERVED_PREMATCH_OR_STALE');
  if(rank(o.singles_rank)==null)return fail('OFFICIAL_RANK_OUT_OF_RANGE');
 }
 const p=inhouseRankProbability(one.singles_rank,two.singles_rank);
 if(p==null)return fail('RANK_PROBABILITY_INVALID');
 return {ok:true,reason:null,modelId:TENNIS_INHOUSE_RANK_VERSION,
  p1:p,p2:1-p,rank1:rank(one.singles_rank),rank2:rank(two.singles_rank),
  forecastAt:iso(now),eventStartTime:iso(start),
  sourceObservationIds:[one.observation_id,two.observation_id],
  rankingObservationClocks:[one.observed_at,two.observed_at],
  usesRestrictedDeepProfiles:false,usesMarketPrices:false,
  rightsStatus:'REVIEW_REQUIRED',researchOnly:true,
  canQualify:false,canAuthorizeWager:false};
}
const digest=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))]
  .map(n=>n.toString(16).padStart(2,'0')).join('');
const latestRanking=async(db,id,source,tour,at)=>{
 return db.prepare(`SELECT observation_id,fbis_player_id,tour,source,singles_rank,
  ranking_date,observed_at
  FROM tennis_ranking_observations
  WHERE fbis_player_id=? AND source=? AND tour=?
   AND singles_rank BETWEEN 1 AND 5000
   AND julianday(observed_at)<=julianday(?)
   AND julianday(ranking_date)<=julianday(?)
  ORDER BY julianday(observed_at) DESC,observation_id DESC LIMIT 1`)
  .bind(id,source,tour,at,at).first();
};
export async function createInhouseRankChallenger(db,{now=new Date(),limit=100}={}){
 if(!db?.prepare)throw Error('DB_REQUIRED');
 const until=new Date(+now+72*3600000).toISOString();
 const q=await db.prepare(`SELECT m.match_id,m.match_id canonical_event_id,m.tour,m.source,
    m.player1_id,m.player2_id,m.match_time event_start_time,
    p1.canonical_name player1,p2.canonical_name player2,
    m.tournament_name,m.surface,m.completion_state,
    m.match_time,m.observed_at
   FROM tennis_official_matches m
   JOIN tennis_players p1 ON p1.fbis_player_id=m.player1_id
   JOIN tennis_players p2 ON p2.fbis_player_id=m.player2_id
   WHERE m.source IN ('ATP_OFFICIAL','WTA_OFFICIAL')
     AND m.completion_state IN ('SCHEDULED','UPCOMING','NOT_STARTED')
     AND julianday(m.match_time)>julianday(?)
     AND julianday(m.match_time)<=julianday(?)
   ORDER BY m.match_time ASC LIMIT ?`)
   .bind(now.toISOString(),until,Math.max(1,Math.min(100,Number(limit)||100))).all();
 const results=[],blocked={};let inserted=0;
 const drop=reason=>{blocked[reason]=(blocked[reason]||0)+1};
 for(const row of q.results||[]){
  const prior=await db.prepare(`SELECT snapshot_id FROM tennis_inhouse_rank_challenger
    WHERE canonical_event_id=? AND model_id=? LIMIT 1`)
    .bind(row.match_id,TENNIS_INHOUSE_RANK_VERSION).first();
  if(prior){results.push({eventId:row.match_id,inserted:false,reason:'FROZEN_EARLIEST_FORECAST_EXISTS'});continue}
  const proof=await proveTennisEvent(db,row);
  if(!proof.valid){drop(proof.reason);results.push({eventId:row.match_id,reason:proof.reason});continue}
  const source=row.tour.toUpperCase()+'_OFFICIAL';
  const one=await latestRanking(db,row.player1_id,source,row.tour,now.toISOString());
  const two=await latestRanking(db,row.player2_id,source,row.tour,now.toISOString());
  const p=validateRankForecast(row,one,two,{now});
  if(!p.ok){drop(p.reason);results.push({eventId:row.match_id,reason:p.reason});continue}
  const checksum=await digest([row.match_id,p.forecastAt,
    ...p.sourceObservationIds,p.rank1,p.rank2,TENNIS_INHOUSE_RANK_VERSION].join('|'));
  const id='trb_'+checksum.slice(0,28);
  const written=await db.prepare(`INSERT OR IGNORE INTO tennis_inhouse_rank_challenger(
    snapshot_id,canonical_event_id,tour,model_id,player1_id,player2_id,
    player1_rank,player2_rank,rank_observation1_id,rank_observation2_id,
    rank_observed1_at,rank_observed2_at,p1_win,p2_win,
    forecast_at,event_start_time,source_rights_status,
    decision_eligible,can_qualify,can_authorize_wager,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'REVIEW_REQUIRED',0,0,0,?)`)
   .bind(id,row.match_id,row.tour,TENNIS_INHOUSE_RANK_VERSION,
    row.player1_id,row.player2_id,p.rank1,p.rank2,...p.sourceObservationIds,
    ...p.rankingObservationClocks,p.p1,p.p2,p.forecastAt,p.eventStartTime,p.forecastAt).run();
  const didWrite=Number(written?.meta?.changes||written?.changes||0)>0;
  if(didWrite)inserted++;
  results.push({eventId:row.match_id,inserted:didWrite,
    forecastAt:p.forecastAt,modelId:p.modelId,probabilityP1:p.p1,
    rank1:p.rank1,rank2:p.rank2,rightsStatus:'REVIEW_REQUIRED'});
 }
 return {ok:true,asOf:now.toISOString(),source:'EXISTING_OFFICIAL_RANK_OBSERVATIONS',
  modelId:TENNIS_INHOUSE_RANK_VERSION,candidates:(q.results||[]).length,
  inserted,blocked,results,sourceTermsReviewed:false,
  researchOnly:true,canQualify:false,canAuthorizeWager:false};
}
export async function inspectInhouseRankChallenger(db,{now=new Date()}={}){
 const q=await db.prepare(`SELECT r.*,m.completion_state,m.result_reason,m.source,
    m.winner_id,m.raw_artifact_key
   FROM tennis_inhouse_rank_challenger r
   LEFT JOIN tennis_official_matches m ON m.match_id=r.canonical_event_id
   ORDER BY r.forecast_at DESC LIMIT 2000`).all();
 const byTour={atp:[],wta:[]},counts={atp:0,wta:0};
 for(const row of q.results||[]){
  if(!byTour[row.tour])continue;
  counts[row.tour]++;
  if(row.source!==(row.tour==='wta'?'WTA_OFFICIAL':'ATP_OFFICIAL')||
    row.completion_state!=='FINAL'||row.result_reason!=='OFFICIAL_COMPLETED_SETS'||
    row.source_rights_status!=='REVIEW_REQUIRED'||!row.winner_id||
    !row.raw_artifact_key?.includes('/official-results/raw/'))continue;
  const y=row.winner_id===row.player1_id?1:row.winner_id===row.player2_id?0:null;
  if(y==null||epoch(row.forecast_at)>=epoch(row.event_start_time))continue;
  byTour[row.tour].push({brier:(row.p1_win-y)**2,
    logLoss:-(y*Math.log(row.p1_win)+(1-y)*Math.log(1-row.p1_win)),
    correct:Number((row.p1_win>=.5?1:0)===y)});
 }
 return {asOf:now.toISOString(),modelId:TENNIS_INHOUSE_RANK_VERSION,
  cohorts:Object.fromEntries(['atp','wta'].map(t=>{
   const a=byTour[t],mean=k=>a.length?a.reduce((n,v)=>n+v[k],0)/a.length:null;
   return [t,{frozenSnapshots:counts[t],settledMatches:a.length,
    brier:mean('brier'),logLoss:mean('logLoss'),winnerAccuracy:mean('correct')}]
  })),sourceRights:'REVIEW_REQUIRED',usesNoncommercialDeepProfiles:false,
  promotionReady:false,canQualify:false,canAuthorizeWager:false};
}
