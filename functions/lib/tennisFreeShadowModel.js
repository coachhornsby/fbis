/** Fixed, uncalibrated research challenger: Elo prior plus observed serving/return form.
 * Coefficients are prespecified; no fitted model or claimed profitable edge.
 */
export const FREE_TENNIS_SHADOW_VERSION='FBIS-TENNIS-FREE-SURFACE-v0.1-SHADOW';
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const logit=p=>Math.log(p/(1-p));
const logistic=x=>1/(1+Math.exp(-x));
const rating=r=>{const n=finite(r);return n!==null&&n>=900&&n<=3000?n:null};
export function calculateTennisFreeShadow({event,one,two,elo1,elo2,now=new Date()}={}){
 const fail=reason=>({ok:false,reason,modelId:FREE_TENNIS_SHADOW_VERSION,
  calibrated:false,contractTradingAuthorized:false});
 const clock=+now,start=Date.parse(event?.match_time),observed=Date.parse(event?.observed_at);
 if(!Number.isFinite(clock)||!Number.isFinite(start)||!Number.isFinite(observed)||
    observed>clock||clock<observed||start-clock<10*60000||start-clock>72*3600000)
  return fail('UPCOMING_VERIFIED_EVENT_WINDOW_REQUIRED');
 if(!['atp','wta'].includes(event?.tour)||
   event.source!==event.tour.toUpperCase()+'_OFFICIAL'||
   event.completion_state!=='SCHEDULED'||
   !event.match_id||!event.player1_id||!event.player2_id||
   event.player1_id===event.player2_id||
   !/^tennis\/official-schedule\//.test(event.raw_artifact_key||''))
  return fail('CANONICAL_SCHEDULE_OR_SOURCE_INVALID');
 const surface=String(event.surface||'').toLowerCase();
 if(!['hard','clay','grass'].includes(surface))return fail('SURFACE_UNKNOWN');
 let provenance;
 try{provenance=JSON.parse(event.provenance_json)}catch{return fail('SCHEDULE_PROVENANCE_INVALID')}
 if(provenance?.source!==event.source||provenance?.blockedReason||
  provenance?.isEstimatedStartTime===true||
  !/^[a-f0-9]{64}$/.test(String(provenance?.rawHash||'')))
  return fail('SCHEDULE_TIME_OR_HASH_UNVERIFIED');
 if([one,two].some((x,i)=>!x?.ok||x.fbisPlayerId!==[event.player1_id,event.player2_id][i]||
   x.researchStats?.tour!==event.tour||
   x.researchStats?.matches<3||
   x.researchStats?.overall?.servePoints<30||
   x.researchStats?.overall?.returnPoints<30||
   Date.parse(x.researchStats.latestObservedAt||'')>=clock||
   Date.parse(x.identityLinkedAt||'')>=clock))
  return fail('PREMATCH_PLAYER_STAT_EVIDENCE_INSUFFICIENT');
 if([elo1,elo2].some(x=>!x||x.tour!==event.tour||
   x.source!=='TENNIS_ABSTRACT_CURRENT_ELO_RESEARCH_ONLY'||
   !/^[a-f0-9]{64}$/.test(String(x.source_hash||''))||
   Date.parse(x.retrievedAt||'')>clock||
   Date.parse(x.reportDate+'T00:00:00Z')>=start||
   rating(x.overall_elo)===null))
  return fail('POINT_IN_TIME_ELO_SOURCE_INCOMPLETE');
 if(elo1.source_hash!==elo2.source_hash||elo1.reportDate!==elo2.reportDate||
    elo1.retrievedAt!==elo2.retrievedAt)
  return fail('ELO_SNAPSHOT_COHORT_MISMATCH');
 const s=surface+'_elo',useSurface=rating(elo1[s])!==null&&rating(elo2[s])!==null;
 const eloDiff=useSurface?(.6*(rating(elo1[s])-rating(elo2[s]))+
   .4*(rating(elo1.overall_elo)-rating(elo2.overall_elo))):
   rating(elo1.overall_elo)-rating(elo2.overall_elo);
 const st1=one.researchStats.overall,st2=two.researchStats.overall;
 const values=[st1.servePoints,st2.servePoints,st1.returnPoints,st2.returnPoints];
 if(values.some(x=>finite(x)===null||Number(x)<=0))return fail('PLAYER_STAT_TOTALS_INVALID');
 const a=[st1.servePoints,st2.servePoints].map(Number);
 const p1Serve=(Number(st1.firstWon)+Number(st1.secondWon))/a[0];
 const p2Serve=(Number(st2.firstWon)+Number(st2.secondWon))/a[1];
 const p1Return=finite(st1.returnPointsWonPct),p2Return=finite(st2.returnPointsWonPct);
 if([p1Serve,p2Serve,p1Return,p2Return].some(x=>x===null||x<0||x>1))
  return fail('SERVE_RETURN_PROBABILITIES_INVALID');
 // Effective point dominance: equal weights to own service and return.
 // Fixed bounded correction: +/-0.25 log-odds, never calibrated.
 const formDelta=.5*(p1Serve+p1Return-p2Serve-p2Return);
 const statCorrection=Math.max(-.25,Math.min(.25,3*formDelta));
 const eloLogit=eloDiff*Math.log(10)/400;
 const logOdds=eloLogit+statCorrection;
 const p1=logistic(logOdds);
 if(!(p1>0&&p1<1))return fail('RESEARCH_PROBABILITY_INVALID');
 return {ok:true,modelId:FREE_TENNIS_SHADOW_VERSION,tour:event.tour,
  eventId:event.match_id,player1Id:event.player1_id,player2Id:event.player2_id,
  p1,p2:1-p1,surface,forecastAt:new Date(clock).toISOString(),
  eventStartTime:new Date(start).toISOString(),
  inputs:{eventSource:event.source,eventObservedAt:event.observed_at,
   eventRawArtifactKey:event.raw_artifact_key,eventRawHash:provenance.rawHash,
   player1:{playerId:one.fbisPlayerId,stats:one.researchStats,
     observationRefs:one.evidenceRefs||[],identityLinkedAt:one.identityLinkedAt,
     observedAsOf:one.asOf},player2:{playerId:two.fbisPlayerId,stats:two.researchStats,
     observationRefs:two.evidenceRefs||[],identityLinkedAt:two.identityLinkedAt,
     observedAsOf:two.asOf},elo:{reportDate:elo1.reportDate,sourceHash:elo1.source_hash,
     retrievedAt:elo1.retrievedAt,overall1:elo1.overall_elo,overall2:elo2.overall_elo,
     surface1:elo1[s]??null,surface2:elo2[s]??null,usesSurface:useSurface},
   formula:{eloDivisor:400,weightSurface:.6,weightOverall:.4,
     formScale:3,formBound:.25,calibrated:false}},
  researchedOnly:true,calibrated:false,decisionEligible:false,
  contractTradingAuthorized:false};
}
