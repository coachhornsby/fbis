/**
 * Predeclared independent prospective comparison of v0.1 and v0.3 NFL models.
 * Both receipt streams must be captured BEFORE kickoff and matched to the same
 * verified regulation final. No historical reconstructed picks may enter.
 */
export const NFL_STANDARD_SHADOW="NFL-VERIFIED-POSSESSION-MATCHUP-SHADOW-v0";
export const NFL_VERIFIED_TRANSITION_SHADOW="NFL-SDV-VERIFIED-POSSESSION-TRANSITION-SHADOW-v0.3";
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const clamp=x=>Math.max(1e-12,Math.min(1-1e-12,x));
const eventKey=r=>[r.homeTeamId,r.awayTeamId,new Date(Date.parse(r.kickoff)).toISOString()].join("|");
const outcome=r=>r.actualHome>r.actualAway?0:r.actualHome<r.actualAway?1:2;
function score(r){
 const probs=[r.homeLead,r.awayLead,r.tieProb],actual=outcome(r),margin=r.actualHome-r.actualAway,total=r.actualHome+r.actualAway;
 return {brier:probs.reduce((s,p,i)=>s+(p-Number(i===actual))**2,0),
  logLoss:-Math.log(clamp(probs[actual])),
  marginMAE:Math.abs(r.projectedHome-r.projectedAway-margin),
  totalMAE:Math.abs(r.projectedHome+r.projectedAway-total),
  signedTotalBias:r.projectedHome+r.projectedAway-total,
  winnerAccuracy:Number(probs.indexOf(Math.max(...probs))===actual)};
}
function interval(delta){
 const n=delta.length;if(n<30)return null;
 let s=0x7e54ba31;
 const rng=()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296};
 const v=[];
 for(let i=0;i<1200;i++){let acc=0;for(let k=0;k<n;k++)acc+=delta[Math.floor(rng()*n)];v.push(acc/n)}
 v.sort((a,b)=>a-b);
 return [v[30],v[1170]];
}
export function compareNflProspectiveShadowReceipts(rows,{asOf,minGames=30}={}){
 if(!Number.isFinite(Date.parse(asOf))||!Number.isInteger(minGames)||minGames<1)
  throw Error("INVALID_NFL_PROSPECTIVE_COMPARE_SCOPE");
 const allowed=[NFL_STANDARD_SHADOW,NFL_VERIFIED_TRANSITION_SHADOW],events=new Map(),excluded={};
 const reject=s=>excluded[s]=(excluded[s]||0)+1;
 for(const r of rows||[]){
  if(!allowed.includes(r.modelId)){reject("MODEL_NOT_ALLOWED");continue}
  if(!r.receiptId||!r.outcomeFingerprint||!r.homeTeamId||!r.awayTeamId||
   ![Date.parse(r.kickoff),Date.parse(r.capturedAt),Date.parse(r.gradedAt),
     Date.parse(r.observedAt)].every(Number.isFinite)||
   !(Date.parse(r.capturedAt)<Date.parse(r.kickoff)&&
     Date.parse(r.kickoff)<=Date.parse(r.observedAt)&&
     Date.parse(r.observedAt)<=Date.parse(r.gradedAt)&&
     Date.parse(r.gradedAt)<=Date.parse(asOf))){reject("TEMPORAL_OR_PROVENANCE_INVALID");continue}
  if(![r.actualHome,r.actualAway,r.projectedHome,r.projectedAway,r.homeLead,r.awayLead,r.tieProb].every(finite)||
   r.actualHome<0||r.actualAway<0||
   [r.homeLead,r.awayLead,r.tieProb].some(p=>p<0||p>1)||
   Math.abs(r.homeLead+r.awayLead+r.tieProb-1)>.005){
   reject("SCORE_OR_PROBABILITY_INVALID");continue;
  }
  const key=eventKey(r);
  if(!events.has(key))events.set(key,new Map());
  const prior=events.get(key).get(r.modelId);
  if(!prior||Date.parse(r.capturedAt)<Date.parse(prior.capturedAt))
   events.get(key).set(r.modelId,r);
 }
 const pairs=[];
 for(const models of events.values()){
  if(!allowed.every(id=>models.has(id))){reject("UNPAIRED_EVENT");continue}
  const [a,b]=allowed.map(id=>models.get(id));
  if(a.actualHome!==b.actualHome||a.actualAway!==b.actualAway){
   reject("OFFICIAL_FINAL_CONFLICT");continue;
  }
  pairs.push({standard:score(a),transition:score(b)});
 }
 const summary=key=>Object.fromEntries(["brier","logLoss","marginMAE","totalMAE","signedTotalBias","winnerAccuracy"].map(k=>[k,mean(pairs.map(p=>p[key][k]))]));
 const differences=Object.fromEntries(["brier","logLoss","marginMAE","totalMAE","winnerAccuracy"].map(k=>{
  const delta=pairs.map(p=>p.transition[k]-p.standard[k]);
  return [k,{mean:mean(delta),bootstrap95:interval(delta)}];
 }));
 return {sport:"nfl",asOf,n:pairs.length,minGames,
  status:pairs.length>=minGames?"PROSPECTIVE_DESCRIPTIVE_COMPARISON":"INSUFFICIENT_PROSPECTIVE_PAIR_SAMPLE",
  standardModelId:allowed[0],transitionModelId:allowed[1],
  standard:summary("standard"),transition:summary("transition"),differences,excluded,
  selectionPredeclared:true,canQualify:false,canAuthorizeWager:false,
  calibrated:false,changesProductionChampion:false,CLV:null,ROI:null};
}
