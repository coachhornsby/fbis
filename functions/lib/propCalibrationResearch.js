/**
 * Research-only probability calibration. Every evaluated row must carry an
 * independently graded official binary outcome and frozen prediction time.
 * Does not infer stakes, historical trades, fees, CLV or profitability.
 */
export function summarizePropCalibration(rows=[],{minimumSample=100}={}) {
 let valid=0,excluded=0,brier=0,logLoss=0,errors={},bins=Array.from({length:10},(_,i)=>({bin:i,n:0,expected:0,observed:0}));
 for(const row of rows) {
  const p=row?.calibratedProbability, outcome=row?.outcome;
  const frozen=Date.parse(row?.frozenAt),start=Date.parse(row?.eventStart),final=Date.parse(row?.finalizedAt);
  const eligible=row?.official===true&&row?.prospective===true&&row?.identityVerified===true&&
   typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1&&(outcome===0||outcome===1)&&
   Number.isFinite(frozen)&&Number.isFinite(start)&&Number.isFinite(final)&&frozen<start&&start<=final&&
   typeof row?.modelVersion==='string'&&row.modelVersion.length>0&&
   typeof row?.contractId==='string'&&row.contractId.length>0;
  if(!eligible){excluded++;errors.INVALID_OR_NONPROSPECTIVE=(errors.INVALID_OR_NONPROSPECTIVE||0)+1;continue;}
  valid++;brier+=(p-outcome)**2;
  const clamped=Math.min(1-1e-12,Math.max(1e-12,p));
  logLoss+=-(outcome*Math.log(clamped)+(1-outcome)*Math.log(1-clamped));
  const bin=bins[Math.min(9,Math.floor(p*10))];bin.n++;bin.expected+=p;bin.observed+=outcome;
 }
 return {status:valid>=minimumSample?'DESCRIPTIVE_ONLY':'INSUFFICIENT_SAMPLE',n:valid,excluded,
  brier:valid?brier/valid:null,logLoss:valid?logLoss/valid:null,
  bins:bins.map(b=>({bin:b.bin,n:b.n,meanPrediction:b.n?b.expected/b.n:null,actualRate:b.n?b.observed/b.n:null})),
  errors,prospectiveEdgeProven:false,canQualify:false,canAuthorizeWager:false};
}
