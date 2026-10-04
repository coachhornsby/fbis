/**
 * CFB prop confidence v2. Stars are probability/calibration-aware, not raw edge badges.
 * Wager authority remains false until walk-forward and prospective gates pass.
 */
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function cfbPropConfidence(row={}){
 const p=finite(row.calibratedHitProbability ?? row.hitProbability);
 const q=clamp(finite(row.dataQuality ?? row.data_quality)??0,0,1);
 const role=clamp(finite(row.roleConfidence ?? row.role_confidence)??0,0,1);
 const unc=String(row.uncertaintyState ?? row.uncertainty_state ?? "").toUpperCase();
 const n=finite(row.validationN)??0; const roi=finite(row.validationRoi);
 if(p==null) return {confidenceScore:null,confidenceStars:null,wagerAuthority:false,reason:"UNCALIBRATED"};
 const be=finite(row.breakEvenProbability)??0.5;
 const probEdge=p-be;
 let score=100*(0.55*clamp(probEdge/0.10,0,1)+0.20*q+0.15*role+0.10*clamp(n/300,0,1));
 if(unc==="HIGH") score=Math.min(score,44); if(q<0.45||role<0.5) score=Math.min(score,44);
 score=Math.round(clamp(score,0,100));
 let stars=score>=85?5:score>=72?4:score>=60?3:score>=48?2:1;
 const validated=n>=100&&roi!=null&&roi>0&&probEdge>0;
 return {confidenceScore:score,confidenceStars:stars,calibratedHitProbability:p,breakEvenProbability:be,estimatedProbabilityEdge:probEdge,
  wagerAuthority:false,validatedResearchSignal:validated,reason:validated?"RESEARCH_VALIDATED_NOT_AUTHORIZED":"RESEARCH_ONLY"};
}
