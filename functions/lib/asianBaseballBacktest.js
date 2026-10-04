/**
 * Temporal walk-forward evaluation and promotion gate for NPB/KBO v2.
 * Inputs must be frozen pregame snapshots. Any row frozen at/after first pitch is rejected.
 */

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;}
function abs(v){return Math.abs(Number(v));}

export function temporalEligible(row){
  const start=Date.parse(row?.start||"");
  const frozen=Date.parse(row?.frozenAt||row?.asOf||"");
  return Number.isFinite(start)&&Number.isFinite(frozen)&&frozen<start;
}

export function gradeProjectionRows(rows=[], modelKey="v2"){
  const eligible=(rows||[]).filter(temporalEligible).filter(r=>{
    const p=r?.[modelKey]||{};
    return finite(p.home)!=null&&finite(p.away)!=null&&finite(r.homeRuns)!=null&&finite(r.awayRuns)!=null;
  });
  const marginErrors=[],totalErrors=[],runErrors=[],briers=[],logLosses=[];
  let winnerCorrect=0,winnerN=0;
  const calibrationBins=Array.from({length:10},()=>({n:0,p:0,y:0}));
  for(const r of eligible){
    const p=r[modelKey], actualMargin=r.homeRuns-r.awayRuns, actualTotal=r.homeRuns+r.awayRuns;
    marginErrors.push(abs((p.home-p.away)-actualMargin));
    totalErrors.push(abs((p.home+p.away)-actualTotal));
    runErrors.push(abs(p.home-r.homeRuns),abs(p.away-r.awayRuns));
    if(r.homeRuns!==r.awayRuns){
      const ph=Math.min(.999,Math.max(.001,finite(p.pHome ?? p.probabilities?.pHomeWin)??.5));
      const y=r.homeRuns>r.awayRuns?1:0;
      briers.push((ph-y)**2);
      logLosses.push(-(y*Math.log(ph)+(1-y)*Math.log(1-ph)));
      const b=Math.min(9,Math.floor(ph*10));
      calibrationBins[b].n++;calibrationBins[b].p+=ph;calibrationBins[b].y+=y;
      winnerN++; if((ph>=.5)===Boolean(y)) winnerCorrect++;
    }
  }
  const n=eligible.length;
  let ece=0;
  for(const b of calibrationBins){
    if(!b.n||!winnerN) continue;
    ece+=(b.n/winnerN)*Math.abs(b.p/b.n-b.y/b.n);
  }
  return {
    n,
    marginMae:mean(marginErrors),totalMae:mean(totalErrors),teamRunMae:mean(runErrors),
    brier:mean(briers),logLoss:mean(logLosses),
    winnerAccuracy:winnerN?winnerCorrect/winnerN:null,ece,
    rejectedTemporal:(rows||[]).length-(rows||[]).filter(temporalEligible).length,
  };
}

function improves(v2,v1,key,tolerance=0){
  const a=finite(v2?.[key]),b=finite(v1?.[key]);
  if(a==null||b==null) return false;
  return a<=b*(1+tolerance);
}

export function evaluateAsianBaseballPromotion({v1={},v2={},minimumN=500}={}){
  const checks={
    sampleSize:(v2.n||0)>=minimumN,
    marginMae:improves(v2,v1,"marginMae",-0.005),
    totalMae:improves(v2,v1,"totalMae",-0.005),
    teamRunMae:improves(v2,v1,"teamRunMae",0),
    brier:finite(v2.brier)!=null&&finite(v1.brier)!=null&&v2.brier<=v1.brier,
    logLoss:finite(v2.logLoss)!=null&&finite(v1.logLoss)!=null&&v2.logLoss<=v1.logLoss,
    calibration:finite(v2.ece)!=null&&v2.ece<=0.04,
    temporalIntegrity:Number(v2.rejectedTemporal||0)===0,
  };
  const pass=Object.values(checks).every(Boolean);
  return {
    pass,checks,
    decision:pass?"PROMOTION_ELIGIBLE":"RESEARCH_ONLY",
    canQualify:pass,
    canAuthorize:false,
    note:pass
      ?"Predictive promotion gate passed. Wager authorization still requires separate market/ROI/staking validation."
      :"Keep v2 research-only; predictive or temporal gate not yet satisfied.",
  };
}

export function compareWalkForward(rows=[], {v1Key="v1",v2Key="v2",minimumN=500}={}){
  const v1=gradeProjectionRows(rows,v1Key);
  const v2=gradeProjectionRows(rows,v2Key);
  return {v1,v2,promotion:evaluateAsianBaseballPromotion({v1,v2,minimumN})};
}
