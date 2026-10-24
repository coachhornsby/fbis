/**
 * NFL/CFB point-in-time research evaluation. Pure functions only.
 * Never promotes a model or writes a wager/settlement.
 */
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const cutoff=s=>typeof s==="string"?Date.parse(s):NaN;
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const clamp=x=>Math.min(1-1e-12,Math.max(1e-12,x));
export function selectPregameSimulationEvidence(rows,{sport,asOf}={}){
 if(!["nfl","cfb"].includes(sport)||!Number.isFinite(cutoff(asOf)))throw Error("INVALID_EVALUATION_SCOPE");
 const picked=[],exclusions={};
 for(const r of rows||[]){
  let reason=null;
  if(r?.sport!==sport)reason="SPORT_MISMATCH";
  else if(r.regulationOnly!==true)reason="REGULATION_SCORE_NOT_VERIFIED";
  else if(!r.gameId||!Number.isFinite(cutoff(r.kickoff))||!Number.isFinite(cutoff(r.frozenAt))||
   !Number.isFinite(cutoff(r.observedAt))||!Number.isFinite(cutoff(r.gradedAt)))reason="MISSING_TIME";
  else if(!(cutoff(r.frozenAt)<cutoff(r.kickoff)&&cutoff(r.kickoff)<cutoff(r.observedAt)&&
    cutoff(r.observedAt)<=cutoff(r.gradedAt)&&cutoff(r.gradedAt)<=cutoff(asOf)))reason="TEMPORAL_VIOLATION";
  else if(![r.homeScore,r.awayScore,r.homeWinProb,r.awayWinProb,r.tieProb,
   r.projectedHome,r.projectedAway,r.homeBlowoutProb,r.awayBlowoutProb].every(finite))reason="MISSING_METRIC";
  else if([r.homeWinProb,r.awayWinProb,r.tieProb,r.homeBlowoutProb,r.awayBlowoutProb].some(p=>p<0||p>1)||
   Math.abs(r.homeWinProb+r.awayWinProb+r.tieProb-1)>0.005)reason="INVALID_PROBABILITIES";
  else if(r.homeScore<0||r.awayScore<0)reason="INVALID_RESULT";
  else if(!r.prospectiveReceiptId||!r.modelVersion||!r.sourceFingerprint)reason="MISSING_PROVENANCE";
  if(reason){exclusions[reason]=(exclusions[reason]||0)+1;continue}
  picked.push(r);
 }
 return {eligible:picked,exclusions};
}
export function gradeRegulationSimulations(rows,{sport,asOf,minSample=30}={}){
 const {eligible,exclusions}=selectPregameSimulationEvidence(rows,{sport,asOf});
 const metrics=eligible.map(r=>{
  const actual=r.homeScore>r.awayScore?0:r.homeScore<r.awayScore?1:2;
  const ps=[r.homeWinProb,r.awayWinProb,r.tieProb];
  const actualMargin=r.homeScore-r.awayScore;
  const actualTotal=r.homeScore+r.awayScore;
  const homeBlowout=Number(actualMargin>=14),awayBlowout=Number(actualMargin<=-14);
  return {winBrier:ps.reduce((s,p,i)=>s+(p-Number(i===actual))**2,0),
   logLoss:-Math.log(clamp(ps[actual])),
   marginError:Math.abs(r.projectedHome-r.projectedAway-actualMargin),
   totalError:Math.abs(r.projectedHome+r.projectedAway-actualTotal),
   blowoutBrier:((r.homeBlowoutProb-homeBlowout)**2+
     (r.awayBlowoutProb-awayBlowout)**2)/2,
   predictedHome:r.homeWinProb,homeWon:Number(actual===0),
   version:r.modelVersion,gameId:r.gameId,receipt:r.prospectiveReceiptId};
 });
 const buckets=Array.from({length:10},(_,i)=>{
  const group=metrics.filter(x=>Math.min(9,Math.floor(x.predictedHome*10))===i);
  return {range:`${i*10}-${(i+1)*10}%`,n:group.length,
    predicted:mean(group.map(x=>x.predictedHome)),observed:mean(group.map(x=>x.homeWon))};
 });
 const qualified=metrics.length>=minSample;
 return {sport,asOf,n:metrics.length,qualifiedForReporting:qualified,
  status:qualified?"DESCRIPTIVE_BACKTEST_ONLY":"INSUFFICIENT_VERIFIED_SAMPLE",
  exclusions,metrics:qualified?{brierScore:mean(metrics.map(x=>x.winBrier)),
   logLoss:mean(metrics.map(x=>x.logLoss)),marginMAE:mean(metrics.map(x=>x.marginError)),
   totalMAE:mean(metrics.map(x=>x.totalError)),
   blowout14Brier:mean(metrics.map(x=>x.blowoutBrier)),calibrationBuckets:buckets}:null,
  // Statistical calibration, prospective qualification and economic edge require
  // separately verified evaluation; a sample threshold alone is never permission.
  calibrated:false,canQualify:false,canAuthorizeWager:false};
}
export function fitNflDriveOutcomeResearch(drives,{asOf,minDrives=500}={}){
 if(!Number.isFinite(cutoff(asOf)))throw Error("INVALID_FIT_CUTOFF");
 const retained=[];let excluded=0;
 for(const d of drives||[]){
  if(!d||!Number.isFinite(cutoff(d.kickoff))||!Number.isFinite(cutoff(d.observedAt))||
    cutoff(d.kickoff)>=cutoff(asOf)||cutoff(d.observedAt)>=cutoff(asOf)||
    !d.gameId||!d.teamId||!["TD","FG","EMPTY"].includes(d.outcome)||
    !Number.isInteger(d.startYardsToGoal)||d.startYardsToGoal<0||d.startYardsToGoal>100){
    excluded++;continue;
  }
  retained.push(d);
 }
 const counts={TD:0,FG:0,EMPTY:0};
 for(const d of retained)counts[d.outcome]++;
 const sufficient=retained.length>=minDrives&&Object.values(counts).every(n=>n>0);
 return {asOf,n:retained.length,excluded,status:sufficient?"RESEARCH_FIT_READY":"INSUFFICIENT_DRIVE_EVIDENCE",
  frequencies:sufficient?Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v/retained.length])):null,
  // Descriptive baseline only: not opponent-conditioned, time/field dependent or validated.
  calibrated:false,canQualify:false,canAuthorizeWager:false};
}
