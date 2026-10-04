/**
 * Game-level wagering decision engine.
 *
 * Principle:
 * independent projection -> offered line/price -> probability -> break-even -> EV
 * -> uncertainty/reliability/intelligence -> confidence -> BET/PASS.
 *
 * Market intelligence never changes the independent projection.
 */
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function americanBreakEven(price){
  const p=finite(price);
  if(p==null||p===0)return null;
  return p<0?(-p)/((-p)+100):100/(p+100);
}

export function americanProfitMultiple(price){
  const p=finite(price);
  if(p==null||p===0)return null;
  return p>0?p/100:100/(-p);
}

export function expectedValuePerUnit(probability,price){
  const p=finite(probability),m=americanProfitMultiple(price);
  if(p==null||m==null||p<0||p>1)return null;
  return p*m-(1-p);
}

// Abramowitz-Stegun normal CDF approximation.
export function normalCdf(x){
  const z=Number(x);
  if(!Number.isFinite(z))return null;
  const sign=z<0?-1:1;
  const a=Math.abs(z)/Math.sqrt(2);
  const t=1/(1+0.3275911*a);
  const erf=sign*(1-((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-a*a));
  return 0.5*(1+erf);
}

export function distributionProbability({market,side,line,meanMargin,meanTotal,sigmaMargin,sigmaTotal,pHomeWin}={}){
  const m=String(market||"").toUpperCase();
  const s=String(side||"").toUpperCase();
  const l=finite(line);
  if(m==="MONEYLINE"){
    const hp=finite(pHomeWin);
    if(hp==null)return null;
    return s==="HOME"?hp:s==="AWAY"?1-hp:null;
  }
  if(m==="SPREAD"){
    const mu=finite(meanMargin),sig=finite(sigmaMargin);
    if(mu==null||sig==null||sig<=0||l==null)return null;
    if(s==="HOME")return 1-normalCdf((0-(mu+l))/sig);
    if(s==="AWAY")return normalCdf((0-(mu-l))/sig);
    return null;
  }
  if(m==="TOTAL"){
    const mu=finite(meanTotal),sig=finite(sigmaTotal);
    if(mu==null||sig==null||sig<=0||l==null)return null;
    const over=1-normalCdf((l-mu)/sig);
    return s==="OVER"?over:s==="UNDER"?1-over:null;
  }
  return null;
}

function scoreFromEv(ev){
  if(ev==null)return 0;
  return clamp((ev+0.01)/0.13*100,0,100);
}
function scoreFromReliability(v, fallback=50){
  const n=finite(v);
  return n==null?fallback:clamp(n<=1?n*100:n,0,100);
}
function scoreFromConfirmation(v){
  const s=String(v||"").toUpperCase();
  if(s==="CONFIRMS")return 78;
  if(s==="OPPOSES")return 38;
  if(s==="MIXED")return 55;
  return 50;
}

/**
 * Raw confidence is a transparent evidence score. It becomes empirically calibrated
 * only when an external calibration function supplies observed monotonic performance.
 */
export function rawWagerConfidence({
  ev,
  matchupReliability,
  dataQuality,
  marketConfirmation,
  historicalFactorReliability,
  priceQuality,
  uncertaintyQuality,
}={}){
  const components={
    ev:scoreFromEv(ev),
    matchupReliability:scoreFromReliability(matchupReliability,55),
    dataQuality:scoreFromReliability(dataQuality,55),
    marketConfirmation:scoreFromConfirmation(marketConfirmation),
    historicalFactorReliability:scoreFromReliability(historicalFactorReliability,50),
    priceQuality:scoreFromReliability(priceQuality,60),
    uncertaintyQuality:scoreFromReliability(uncertaintyQuality,55),
  };
  const score=
    0.30*components.ev+
    0.15*components.matchupReliability+
    0.15*components.dataQuality+
    0.10*components.marketConfirmation+
    0.15*components.historicalFactorReliability+
    0.05*components.priceQuality+
    0.10*components.uncertaintyQuality;
  return {score:Math.round(clamp(score,0,100)),components};
}

export function decisionFromOffer({
  offer,
  distribution,
  intelligence=null,
  evidence={},
  minEv=0.03,
  calibratedConfidence=null,
  confidenceCalibrationN=0,
  stakeRulesValidated=false,
}={}){
  const probability=distributionProbability({
    market:offer?.market,side:offer?.side,line:offer?.line,
    meanMargin:distribution?.margin,meanTotal:distribution?.total,
    sigmaMargin:distribution?.sigmaMargin,sigmaTotal:distribution?.sigmaTotal,
    pHomeWin:distribution?.pHomeWin,
  });
  const price=finite(offer?.price);
  const breakEven=americanBreakEven(price);
  const ev=expectedValuePerUnit(probability,price);
  const raw=rawWagerConfidence({
    ev,
    matchupReliability:evidence.matchupReliability,
    dataQuality:evidence.dataQuality,
    marketConfirmation:intelligence?.marketConfirmation,
    historicalFactorReliability:evidence.historicalFactorReliability,
    priceQuality:evidence.priceQuality,
    uncertaintyQuality:evidence.uncertaintyQuality,
  });
  const calibrated=finite(calibratedConfidence);
  const confidence=calibrated!=null?clamp(calibrated,0,100):raw.score;
  const calibrationState=calibrated!=null&&confidenceCalibrationN>=30?"EMPIRICAL":"PROVISIONAL";
  const dataOk=evidence.dataQuality==null||Number(evidence.dataQuality)>=0.45;
  const reliabilityOk=evidence.matchupReliability==null||Number(evidence.matchupReliability)>=0.40;
  const bet=probability!=null&&breakEven!=null&&ev!=null&&ev>=minEv&&dataOk&&reliabilityOk;
  return {
    market:offer?.market||null,side:offer?.side||null,line:finite(offer?.line),price,
    sportsbook:offer?.sportsbook||null,observedAt:offer?.observedAt||null,
    modelProbability:probability,breakEvenProbability:breakEven,probabilityEdge:probability==null||breakEven==null?null:probability-breakEven,
    expectedValue:ev,
    uncertainty:{sigmaMargin:finite(distribution?.sigmaMargin),sigmaTotal:finite(distribution?.sigmaTotal)},
    evidence:{...evidence},
    marketIntelligence:intelligence,
    confidence,
    rawConfidence:raw.score,
    confidenceComponents:raw.components,
    confidenceCalibrationState:calibrationState,
    confidenceCalibrationN:Number(confidenceCalibrationN)||0,
    decision:bet?"BET":"PASS",
    stakeUnits:bet&&stakeRulesValidated?evidence.stakeUnits??null:null,
    stakeState:stakeRulesValidated?"VALIDATED_RULES":"NO_STAKE_RULES",
    reason:bet?"Positive expected value clears minimum with acceptable evidence quality":
      ev==null?"Offer cannot be priced":ev<minEv?"Expected value below minimum":"Evidence quality/reliability gate failed",
  };
}
