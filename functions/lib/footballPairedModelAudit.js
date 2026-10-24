/** Deterministic paired sport-specific scoring and uncertainty audit. Research-only. */
const avg=v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const valid=x=>typeof x==="number"&&Number.isFinite(x);
const clamp=p=>Math.min(1-1e-12,Math.max(1e-12,p));
const metrics=(rows,prefix)=>({
 marginMAE:avg(rows.map(r=>Math.abs(r[prefix+"Home"]-r[prefix+"Away"]-(r.actualHome-r.actualAway)))),
 totalMAE:avg(rows.map(r=>Math.abs(r[prefix+"Home"]+r[prefix+"Away"]-r.actualHome-r.actualAway))),
 marginBias:avg(rows.map(r=>r[prefix+"Home"]-r[prefix+"Away"]-(r.actualHome-r.actualAway))),
 totalBias:avg(rows.map(r=>r[prefix+"Home"]+r[prefix+"Away"]-r.actualHome-r.actualAway)),
 marginRMSE:Math.sqrt(avg(rows.map(r=>(r[prefix+"Home"]-r[prefix+"Away"]-r.actualHome+r.actualAway)**2))),
 winnerAccuracy:avg(rows.map(r=>Number(Math.sign(r[prefix+"Home"]-r[prefix+"Away"])===Math.sign(r.actualHome-r.actualAway)))),
});
function ci(diffs,draws){
 let seed=0x6fa3b82c;
 const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296};
 const n=diffs.length,scores=[];
 for(let b=0;b<draws;b++){
  let s=0;for(let k=0;k<n;k++)s+=diffs[Math.floor(next()*n)];
  scores.push(s/n);
 }
 scores.sort((a,b)=>a-b);
 return [scores[Math.floor(draws*.025)],scores[Math.floor(draws*.975)]];
}
export function evaluatePairedModels(rows,{sport,minimumSample=30,bootstrapDraws=800}={}){
 if(!["nfl","cfb"].includes(sport)||!Number.isInteger(minimumSample)||minimumSample<1||
   !Number.isInteger(bootstrapDraws)||bootstrapDraws<100||bootstrapDraws>5000)
  throw Error("INVALID_PAIRED_EVALUATION_CONFIG");
 const seen=new Set();
 for(const r of rows){
  if(r.sport!==sport||seen.has(r.gameId)||!r.gameId||!r.baselineSnapshotId||
   r.evidenceMode!=="RECONSTRUCTED_HISTORICAL_NOT_PIT"||r.prospective!==false||
   r.canAuthorizeWager!==false||
   ![r.actualHome,r.actualAway,r.championHome,r.championAway,r.challengerHome,
   r.challengerAway,r.homeLeadProb,r.awayLeadProb,r.tieProb,
   r.homeBlowoutProb,r.awayBlowoutProb].every(valid)||
   Math.abs(r.homeLeadProb+r.awayLeadProb+r.tieProb-1)>0.005||
   ![r.homeLeadProb,r.awayLeadProb,r.tieProb,r.homeBlowoutProb,r.awayBlowoutProb].every(p=>p>=0&&p<=1)||
   !(Date.parse(r.frozenAt)<Date.parse(r.kickoff)))
   throw Error("UNPAIRED_OR_UNVERIFIED_EVALUATION_ROW");
  seen.add(r.gameId);
 }
 const champ=metrics(rows,"champion"),challenger=metrics(rows,"challenger"),n=rows.length;
 const marginDeltas=rows.map(r=>Math.abs(r.challengerHome-r.challengerAway-r.actualHome+r.actualAway)-
  Math.abs(r.championHome-r.championAway-r.actualHome+r.actualAway));
 const totalDeltas=rows.map(r=>Math.abs(r.challengerHome+r.challengerAway-r.actualHome-r.actualAway)-
  Math.abs(r.championHome+r.championAway-r.actualHome-r.actualAway));
 const brier=avg(rows.map(r=>{
  const o=r.actualHome>r.actualAway?0:r.actualHome<r.actualAway?1:2;
  return [r.homeLeadProb,r.awayLeadProb,r.tieProb].reduce((a,p,i)=>a+(p-Number(i===o))**2,0);
 }));
 const logLoss=avg(rows.map(r=>{
  const o=r.actualHome>r.actualAway?0:r.actualHome<r.actualAway?1:2;
  return -Math.log(clamp([r.homeLeadProb,r.awayLeadProb,r.tieProb][o]));
 }));
 const blowout14Brier=avg(rows.map(r=>(
   (r.homeBlowoutProb-Number(r.actualHome-r.actualAway>=14))**2+
   (r.awayBlowoutProb-Number(r.actualAway-r.actualHome>=14))**2)/2));
 return {sport,n,minimumSample,status:n>=minimumSample?"PAIRED_RECONSTRUCTED_RESEARCH_ONLY":"INSUFFICIENT_PAIRED_SAMPLE",
  champion:champ,challenger:{...challenger,multiclassBrier:brier,logLoss,blowout14Brier},
  pairedDeltas:{marginMAE:avg(marginDeltas),totalMAE:avg(totalDeltas),
   marginBootstrap95:n?ci(marginDeltas,bootstrapDraws):null,
   totalBootstrap95:n?ci(totalDeltas,bootstrapDraws):null,
   interpretation:"challenger-minus-champion; negative favors challenger"},
  derivedFromChampionInputs:true,historicalPITCertified:false,
  calibrated:false,prospectiveValidated:false,canQualify:false,canAuthorizeWager:false};
}
