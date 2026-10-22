/**
 * Independent, deterministic CFB drive V2 qualification research.
 * All inputs from CFB_DB; no paid requests, model promotion, or wagers.
 * At most one (earliest true pregame) V2 receipt per independent game.
 */
const finite=x=>typeof x==="number" && Number.isFinite(x);
const t=x=>typeof x==="string"&&x?Date.parse(x):NaN;
const round=x=>Math.round(x*10000)/10000;
const mean=a=>a.length?round(a.reduce((s,x)=>s+x,0)/a.length):null;
function quantile(sorted,p){
 if(!sorted.length)return null;
 const pos=(sorted.length-1)*p,i=Math.floor(pos),f=pos-i;
 return round(sorted[i]*(1-f)+sorted[Math.min(i+1,sorted.length-1)]*f);
}
function wilson(k,n,z=1.959963984540054){
 if(!n)return null;
 const ph=k/n,z2=z*z,d=1+z2/n;
 const middle=ph+z2/(2*n),extra=z*Math.sqrt(ph*(1-ph)/n+z2/(4*n*n));
 return {rate:round(ph),low:round((middle-extra)/d),high:round((middle+extra)/d),n};
}
function bootstrapPaired(diffs,{replicates=2000}={}){
 if(diffs.length<30)return null;
 let seed=2166136261;
 for(const value of diffs)for(const ch of String(value))seed=Math.imul(seed^ch.charCodeAt(0),16777619)>>>0;
 function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;}
 const sims=[];
 for(let k=0;k<replicates;k++){
   let sum=0;
   for(let i=0;i<diffs.length;i++)sum+=diffs[Math.floor(random()*diffs.length)];
   sims.push(sum/diffs.length);
 }
 sims.sort((a,b)=>a-b);
 return {pairedMeanImprovement:mean(diffs),ci95Low:quantile(sims,.025),
   ci95High:quantile(sims,.975),method:"DETERMINISTIC_PAIRED_BOOTSTRAP",
   replicates,positiveEvidence:quantile(sims,.025)>0};
}
const parse=s=>{try{return JSON.parse(s)}catch{return null}};
const isValidSource=r=>r.source_verified===1 && r.source_period==="REGULATION_ONLY" &&
 r.source_fingerprint===r.grade_fingerprint &&
 finite(r.actual_home)&&finite(r.actual_away)&&
 Number.isFinite(t(r.source_observed_at))&&t(r.source_observed_at)>t(r.kickoff);
export function evaluateCfbDrivePhase5(rows=[],{now=new Date().toISOString()}={}){
 if(!Number.isFinite(t(now)))throw Error("INVALID_AUDIT_CLOCK");
 const chosen=new Map();
 let invalidFrozen=0,duplicates=0;
 for(const r of rows){
   if(!Number.isFinite(t(r.frozen_at)) || !Number.isFinite(t(r.kickoff))||
       t(r.frozen_at)>=t(r.kickoff) ||
       r.authority!=="RESEARCH_SHADOW_ONLY"||r.can_authorize_wager!==0){
     invalidFrozen++;continue;
   }
   const key=String(r.game_id||"");
   if(!key)continue;
   const old=chosen.get(key);
   if(old){duplicates++;
     if(t(r.frozen_at)>t(old.frozen_at)||
        (r.frozen_at===old.frozen_at&&String(r.id)>=String(old.id)))continue;
   }
   chosen.set(key,r);
 }
 const records=[...chosen.values()].sort((a,b)=>String(a.kickoff).localeCompare(String(b.kickoff))||
         String(a.game_id).localeCompare(String(b.game_id)));
 const done=records.filter(r=>t(r.kickoff)<=t(now));
 // Use 36 hours' aging before classifying a result as late/missing, so normal
 // postgame collector's next morning run has a chance to observe it.
 const overdue=records.filter(r=>t(r.kickoff)+36*3600*1000<t(now));
 const graded=[],excluded=[];
 for(const r of records){
  if(r.grade_run_id==null)continue;
  if(t(r.kickoff)>t(now)||!isValidSource(r)){excluded.push({gameId:r.game_id,reason:"UNVERIFIED_OR_PREMATURE_GRADE"});continue;}
  const dist=parse(r.distributions_json),base=parse(r.baseline_json);
  const home=base?.home,away=base?.away;
  if(![home,away,dist?.total?.mean,dist?.margin?.mean,dist?.home_score?.mean,
        dist?.away_score?.mean,dist?.total?.p10,dist?.total?.p90,
        dist?.margin?.p10,dist?.margin?.p90].every(finite)){
    excluded.push({gameId:r.game_id,reason:"INVALID_FROZEN_EVIDENCE"});continue;
  }
  const total=r.actual_home+r.actual_away,margin=r.actual_home-r.actual_away;
  const originalTotalError=Math.abs(total-(home+away)),v2TotalError=Math.abs(total-dist.total.mean);
  const originalMarginError=Math.abs(margin-(home-away)),v2MarginError=Math.abs(margin-dist.margin.mean);
  graded.push({
   gameId:r.game_id,kickoff:r.kickoff,
   frozenAt:r.frozen_at,sourceObservedAt:r.source_observed_at,
   evidenceFingerprint:r.evidence_fingerprint,
   originalTotalError,v2TotalError,originalMarginError,v2MarginError,
   deltaTotal:originalTotalError-v2TotalError,
   deltaMargin:originalMarginError-v2MarginError,
   total80:Number(total>=dist.total.p10&&total<=dist.total.p90),
   margin80:Number(margin>=dist.margin.p10&&margin<=dist.margin.p90),
   total90:Number(total>=dist.total.p05&&total<=dist.total.p95),
   margin90:Number(margin>=dist.margin.p05&&margin<=dist.margin.p95),
  });
 }
 const n=graded.length;
 const dates=[...new Set(graded.map(g=>String(g.kickoff).slice(0,10)))].sort();
 const overdueGraded=overdue.filter(r=>graded.some(g=>g.gameId===r.game_id)).length;
 const coverage=overdue.length?wilson(overdueGraded,overdue.length):null;
 const pending=records.filter(r=>t(r.kickoff)>t(now)).length;
 const sourceMissing=done.length-graded.length;
 const mk=k=>mean(graded.map(r=>r[k]));
 const bTotal=bootstrapPaired(graded.map(r=>r.deltaTotal));
 const bMargin=bootstrapPaired(graded.map(r=>r.deltaMargin));
 const cov={total80:wilson(graded.reduce((s,r)=>s+r.total80,0),n),
   margin80:wilson(graded.reduce((s,r)=>s+r.margin80,0),n),
   total90:wilson(graded.reduce((s,r)=>s+r.total90,0),n),
   margin90:wilson(graded.reduce((s,r)=>s+r.margin90,0),n)};
 const gates={
   atLeast30DistinctGraded:n>=30,
   atLeast2KickoffDates:dates.length>=2,
   agedOutcomeCaptureAtLeast75Pct:coverage!==null&&coverage.rate>=.75,
   noInvalidHistoricalReceipts:invalidFrozen===0,
   noInvalidGrades:excluded.length===0,
 };
 const researchEvaluable=Object.values(gates).every(Boolean);
 // Empirical interval reliability and paired score improvement must be
 // separately established; these are not enough for model promotion.
 const positiveSignal=researchEvaluable && bTotal?.positiveEvidence===true &&
   bMargin?.positiveEvidence===true &&
   cov.total80?.rate>=.65&&cov.margin80?.rate>=.65 &&
   cov.total90?.rate>=.80&&cov.margin90?.rate>=.80;
 return {
  ok:true,source:"CFB_DB",model:"CFB-DRIVE-STATE-SHADOW-v2",
  classification:"RESEARCH_ONLY",auditAt:now,
  sample:{frozen:records.length,alreadyStarted:done.length,
    notYetStarted:pending,overdueForSource:overdue.length,
    overdueWithVerifiedGrades:overdueGraded,
    ungradedStarted:sourceMissing,verifiedGrades:n,gradeDates:dates,
    duplicateRunRows:duplicates,invalidFrozenRows:invalidFrozen,
    invalidGradeRows:excluded.length,agedResultCapture:coverage},
  gradesExcluded:excluded.slice(0,12),
  pairedError:{
   originalTotalMAE:mk("originalTotalError"),v2TotalMAE:mk("v2TotalError"),
   originalMarginMAE:mk("originalMarginError"),v2MarginMAE:mk("v2MarginError"),
   totalImprovement:bTotal,marginImprovement:bMargin,
  },
  intervalCalibration:cov,qualificationGates:gates,
  researchEvaluable,positiveResearchSignal:Boolean(positiveSignal),
  conclusion:researchEvaluable
   ? positiveSignal?"PROMISING_PROSPECTIVE_RESEARCH_ONLY":"EVIDENCE_DOES_NOT_QUALIFY_V2_FOR_PROMOTION"
   :"NOT_EVALUABLE_PENDING_VERIFIED_OUTCOMES",
  noAutomaticPromotion:true,canAuthorizeWager:false,
  limitations:["REGULATION_ONLY","NO_NCAA_OVERTIME","NO_PLAYER_PROPS",
    "NO_VALIDATED_MONEYLINE_PROBABILITIES","NOT_P_AND_L_VALIDATED",
    "AS_OF_RESEARCH_WITH_EARLIER_CHAMPION_BASELINE"],
 };
}
export async function cfbDrivePhase5Audit(env,{now=new Date().toISOString()}={}){
 const db=env?.CFB_DB;
 if(!db?.prepare)throw Error("CFB_DB_UNBOUND");
 const sql=`SELECT r.id,r.game_id,r.frozen_at,r.kickoff,r.authority,
         r.can_authorize_wager,r.evidence_fingerprint,
         r.baseline_json,r.distributions_json,
         g.run_id grade_run_id,g.source_fingerprint grade_fingerprint,
         g.score_home actual_home,g.score_away actual_away,
         v.verified_against_game source_verified,v.period_scope source_period,
         v.source_fingerprint,v.source_observed_at
       FROM cfb_drive_shadow_runs r
       LEFT JOIN cfb_drive_shadow_grades g ON g.run_id=r.id
       LEFT JOIN cfb_drive_verified_games v ON v.game_id=r.game_id
       WHERE r.simulator_version='CFB-DRIVE-STATE-SHADOW-v2'
       ORDER BY r.kickoff,r.game_id,r.frozen_at,r.id LIMIT 501`;
 const out=await db.prepare(sql).all();
 if(!Array.isArray(out?.results))throw Error("CFB_QUALIFICATION_DB_READ_FAILED");
 if(out.results.length>=501)throw Error("CFB_QUALIFICATION_ROW_CAP_REACHED");
 return evaluateCfbDrivePhase5(out.results,{now});
}
