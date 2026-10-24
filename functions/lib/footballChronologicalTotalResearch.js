/**
 * NFL / CFB score-component research. Never influences wagers or champions.
 *
 * A score-component challenger may replace TOTAL only, preserving the frozen
 * champion's signed margin. Alpha is fit exclusively on earlier game dates.
 * Source artifact is postgame-reconstructed SDV; this is NOT historical PIT.
 */
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const mean=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
const grid=Object.freeze([0,.05,.1,.2,.35,.5,.75,1]);
const day=s=>String(s||"").slice(0,10);
function requireValid(rows,sport){
 const seen=new Set();
 for(const r of rows){
  const t=Date.parse(r.kickoff),f=Date.parse(r.frozenAt);
  if(r.sport!==sport||!r.gameId||seen.has(r.gameId)||!Number.isFinite(t)||
   !Number.isFinite(f)||f>=t||
   r.evidenceMode!=="RECONSTRUCTED_HISTORICAL_NOT_PIT"||
   r.prospective!==false||r.canAuthorizeWager!==false||
   ![r.actualHome,r.actualAway,r.championHome,r.championAway,
   r.challengerHome,r.challengerAway].every(finite))
   throw Error("INVALID_RECONSTRUCTED_PAIRED_GAME");
  seen.add(r.gameId);
 }
}
export function totalOnlyProjection(r,alpha){
 if(!finite(alpha)||alpha<0||alpha>1)throw Error("INVALID_TOTAL_ALPHA");
 const margin=r.championHome-r.championAway;
 const total=(r.championHome+r.championAway)*(1-alpha)+
  (r.challengerHome+r.challengerAway)*alpha;
 // A research total may not imply negative participant scores.
 if(!finite(total)||total<Math.abs(margin))return null;
 return {home:(total+margin)/2,away:(total-margin)/2,total,margin,
  usesChampionMargin:true,alpha,canAuthorizeWager:false};
}
function errors(rows,alpha){
 const out=[];
 for(const r of rows){
  const projection=totalOnlyProjection(r,alpha);
  if(!projection)return null;
  out.push(Math.abs(projection.total-r.actualHome-r.actualAway));
 }
 return out;
}
function interval(values,draws=1200){
 if(!values.length)return null;
 let seed=0x5aa639ed;
 const rng=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296};
 const boot=[];
 for(let i=0;i<draws;i++){
  let sum=0;for(let j=0;j<values.length;j++)sum+=values[Math.floor(rng()*values.length)];
  boot.push(sum/values.length);
 }
 boot.sort((a,b)=>a-b);
 return [boot[Math.floor(draws*.025)],boot[Math.floor(draws*.975)]];
}
export function evaluateChronologicalTotalOnly(rows,{
 sport,trainFraction=.60,minTrain=50,minHoldout=40,
}={}){
 if(!["nfl","cfb"].includes(sport)||!finite(trainFraction)||
  trainFraction<.4||trainFraction>.8||!Number.isInteger(minTrain)||
  !Number.isInteger(minHoldout)||minTrain<1||minHoldout<1)
  throw Error("INVALID_TEMPORAL_EVALUATION_SETTINGS");
 requireValid(rows,sport);
 const sorted=[...rows].sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff)||
  String(a.gameId).localeCompare(String(b.gameId)));
 if(!sorted.length)return {sport,n:0,status:"NO_VERIFIED_GAMES",
  alpha:null,canAuthorizeWager:false,canQualify:false};
 // All games with the same UTC date must stay in one fold.
 const splitIndex=Math.floor(sorted.length*trainFraction);
 const cutoffDay=day(sorted[Math.min(sorted.length-1,splitIndex)].kickoff);
 const train=sorted.filter(r=>day(r.kickoff)<cutoffDay);
 const holdout=sorted.filter(r=>day(r.kickoff)>=cutoffDay);
 const base={sport,n:sorted.length,trainN:train.length,holdoutN:holdout.length,
  cutoffDay,sourceEvidence:"POSTGAME_RECONSTRUCTED_NOT_PROSPECTIVE",
  alpha:null,championMarginPreserved:true,
  canQualify:false,canAuthorizeWager:false,
  noChampionOrWagerRouting:true};
 if(train.length<minTrain||holdout.length<minHoldout)return{
  ...base,status:"INSUFFICIENT_CHRONOLOGICAL_EVIDENCE",training:null,holdout:null};
 const fitting=grid.map(alpha=>({alpha,loss:mean(errors(train,alpha)||[]) }))
   .filter(x=>finite(x.loss));
 if(!fitting.length)return {...base,status:"NO_FEASIBLE_TOTAL_ADJUSTMENT",
  training:null,holdout:null};
 // Stable tie-break: smaller alpha wins, avoiding unnecessary correction.
 fitting.sort((a,b)=>a.loss-b.loss||a.alpha-b.alpha);
 const winner=fitting[0];
 const championTrain=errors(train,0),championTest=errors(holdout,0);
 const candidateTest=errors(holdout,winner.alpha);
 if(!candidateTest)return {...base,alpha:winner.alpha,
  status:"HOLDOUT_INVALID_SCORE_RECONSTRUCTION",training:null,holdout:null};
 const deltas=candidateTest.map((x,i)=>x-championTest[i]),uncertainty=interval(deltas);
 const holdoutImprovement=mean(deltas)<0;
 const intervalSupportsImprovement=uncertainty[1]<0;
 const guardSatisfied=holdoutImprovement&&intervalSupportsImprovement;
 return {...base,alpha:winner.alpha,
  training:{n:train.length,championTotalMAE:mean(championTrain),
   fittedTotalMAE:winner.loss,selectionGrid:[...grid]},
  holdout:{n:holdout.length,championTotalMAE:mean(championTest),
   candidateTotalMAE:mean(candidateTest),deltaMAE:mean(deltas),
   bootstrap95:uncertainty},
  status:guardSatisfied?"RESEARCH_SIGNAL_REQUIRES_PROSPECTIVE_VALIDATION":
   "NO_VALIDATED_TOTAL_ONLY_IMPROVEMENT",
  historicalHoldoutSupportsImprovement:guardSatisfied,
  // Even if a retrospective holdout improves, it cannot directly qualify a
  // betting model. Prospective independent promotion remains a separate gate.
  calibrated:false,prospectiveValidated:false};
}
