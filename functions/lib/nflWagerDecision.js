import {currentActionDisplay} from './actionDisplayFreshness.js';
import {actionTimestampMs, currentActionRows, historicalActionRows} from './actionTemporalValidity.js';
/**
 * NFL game-level wager decisioning.
 *
 * Architecture:
 *  independent NFL projection (market-free)
 *    -> explain disagreement
 *    -> compare with executable line + actual price
 *    -> price probability / EV
 *    -> layer ACTION trajectory as non-authoritative wager intelligence
 *    -> BET only when calibrated decision gates pass
 *
 * ACTION never enters the PURE projection and never creates a wager by itself.
 * Closing data is evaluation-only.
 */

export const NFL_WAGER_DECISION_VERSION = "NFL-WAGER-v2";
export const NFL_CONFIDENCE_VERSION = "NFL-CONFIDENCE-v1";

function finite(v){
  if(v==null||v==="") return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function round(v,d=4){const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p;}
function erf(x){
  const sign=x<0?-1:1,a=Math.abs(x),t=1/(1+0.3275911*a);
  const y=1-(((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t)*Math.exp(-a*a);
  return sign*y;
}
function normalCdf(z){return .5*(1+erf(z/Math.sqrt(2)));}

export function americanBreakEven(price){
  const p=finite(price);
  if(p==null||p===0)return null;
  return p<0?(-p)/((-p)+100):100/(p+100);
}
export function americanProfitPerUnitRisk(price){
  const p=finite(price);
  if(p==null||p===0)return null;
  return p<0?100/(-p):p/100;
}
export function expectedValuePerUnitRisk(probability,price){
  const p=finite(probability),profit=americanProfitPerUnitRisk(price);
  if(p==null||profit==null)return null;
  return p*profit-(1-p);
}
function coverProbability(meanMargin,sigma,homeSpread,selection){
  const m=finite(meanMargin),s=finite(sigma),line=finite(homeSpread);
  if(m==null||s==null||s<=0||line==null)return null;
  const pHome=1-normalCdf((-line-m)/s);
  return String(selection).toLowerCase()==="home"?pHome:1-pHome;
}
function totalProbability(meanTotal,sigma,line,selection){
  const m=finite(meanTotal),s=finite(sigma),l=finite(line);
  if(m==null||s==null||s<=0||l==null)return null;
  const pOver=1-normalCdf((l-m)/s);
  return String(selection).toLowerCase()==="over"?pOver:1-pOver;
}

function pickExecution(game={}){
  const m=game.market||{},x=m.execution||{};
  const offer=x.selectedOffer||x.bestOffer||m.comparison||{};
  const spread=finite(x.spread??offer.spread??game.odds?.spread);
  const total=finite(x.total??offer.total??game.odds?.total);
  const book=x.book||offer.book||game.odds?.softSource||null;

  const homeSpreadPrice=finite(
    x.spreadHomePrice??x.homeSpreadPrice??x.spreadPrice?.home??x.spreadPrice??
    x.offers?.spread?.price??offer.spreadHomePrice??
    game.odds?.heritageSpreadHomePrice??game.odds?.softSpreadHomePrice??
    game.odds?.spreadHomeOdds??game.odds?.homeSpreadOdds
  );
  const awaySpreadPrice=finite(
    x.spreadAwayPrice??x.awaySpreadPrice??x.spreadPrice?.away??offer.spreadAwayPrice??
    game.odds?.heritageSpreadAwayPrice??game.odds?.softSpreadAwayPrice??
    game.odds?.spreadAwayOdds??game.odds?.awaySpreadOdds
  );
  const overPrice=finite(
    x.overPrice??x.totalOverPrice??x.totalPrice?.over??x.totalPrice??
    x.offers?.total?.price??offer.overPrice??
    game.odds?.heritageOverPrice??game.odds?.softOverPrice??game.odds?.overOdds
  );
  const underPrice=finite(
    x.underPrice??x.totalUnderPrice??x.totalPrice?.under??offer.underPrice??
    game.odds?.heritageUnderPrice??game.odds?.softUnderPrice??game.odds?.underOdds
  );

  const actionable=Boolean(
    m.executionActionable??x.actionable??x.available??false
  );
  const fresh=!(game.marketStale||game.odds?.stale||x.freshness==="STALE");
  return {spread,total,homeSpreadPrice,awaySpreadPrice,overPrice,underPrice,book,actionable,fresh};
}

function trajectoryRows(actionIntel={},family,selection,decisionAt){
  const rows=historicalActionRows(actionIntel.lineHistory||[],{now:decisionAt}).filter(r=>{
    const market=String(r.market||"").toLowerCase();
    const sel=String(r.selection||"").toLowerCase();
    return market===family&&sel===selection&&finite(r.line)!=null;
  }).sort((a,b)=>actionTimestampMs(a.providerTimestamp||a.collectedAt)-actionTimestampMs(b.providerTimestamp||b.collectedAt));
  // Historical opening is context only; a current terminal observation is required.
  return currentActionRows(rows.slice(-1),{now:decisionAt}).length ? rows : [];
}
function slopePerHour(rows){
  if(rows.length<2)return null;
  const a=rows[0],b=rows.at(-1);
  const t0=Date.parse(a.providerTimestamp||a.collectedAt||"");
  const t1=Date.parse(b.providerTimestamp||b.collectedAt||"");
  if(!Number.isFinite(t0)||!Number.isFinite(t1)||t1<=t0)return null;
  return (Number(b.line)-Number(a.line))/((t1-t0)/3600000);
}
function sign(v){const n=finite(v);return n==null||Math.abs(n)<1e-9?0:(n>0?1:-1);}

export function buildNflWagerIntelligence(game={},projection={}, {decisionAt=Date.now()}={}){
  const a=currentActionDisplay(game,decisionAt).actionIntel||{};
  const spreadRows=trajectoryRows(a,"spread","home",decisionAt);
  const totalRows=trajectoryRows(a,"total","over",decisionAt);
  const spreadOpen=spreadRows[0]||null,spreadNow=spreadRows.at(-1)||null;
  const totalOpen=totalRows[0]||null,totalNow=totalRows.at(-1)||null;

  const spreadMove=spreadOpen&&spreadNow?Number(spreadNow.line)-Number(spreadOpen.line):null;
  const totalMove=totalOpen&&totalNow?Number(totalNow.line)-Number(totalOpen.line):null;
  const currentSpread=finite(spreadNow?.line??a.consensus?.spreadHome);
  const currentTotal=finite(totalNow?.line??a.consensus?.total);
  const fairSpread=finite(projection.margin)==null?null:-Number(projection.margin);
  const fairTotal=finite(projection.total);
  const spreadEdgeNow=fairSpread!=null&&currentSpread!=null?fairSpread-currentSpread:null;
  const spreadEdgeOpen=fairSpread!=null&&finite(spreadOpen?.line)!=null?fairSpread-Number(spreadOpen.line):null;
  const totalEdgeNow=fairTotal!=null&&currentTotal!=null?fairTotal-currentTotal:null;
  const totalEdgeOpen=fairTotal!=null&&finite(totalOpen?.line)!=null?fairTotal-Number(totalOpen.line):null;

  const splits=a.publicSplits||{};
  const ticket=finite(splits.ticketPct),money=finite(splits.moneyPct);
  const divergence=ticket!=null&&money!=null?money-ticket:finite(splits.moneyTicketGap);

  const spreadMoveSigns=spreadRows.slice(1).map((r,i)=>sign(Number(r.line)-Number(spreadRows[i].line))).filter(Boolean);
  const totalMoveSigns=totalRows.slice(1).map((r,i)=>sign(Number(r.line)-Number(totalRows[i].line))).filter(Boolean);
  const persistence=(xs)=>xs.length<2?null:Math.abs(xs.reduce((a,b)=>a+b,0))/xs.length;
  const reversal=(xs)=>xs.some((x,i)=>i>0&&x!==xs[i-1]);

  // For home spread, movement downward favors home; upward favors away.
  const modelSide=spreadEdgeNow==null?null:(spreadEdgeNow<0?"home":"away");
  const marketSide=spreadMove==null||spreadMove===0?null:(spreadMove<0?"home":"away");
  const spreadConfirmation=modelSide&&marketSide?(modelSide===marketSide?"CONFIRMS":"OPPOSES"):null;

  const totalSide=totalEdgeNow==null?null:(totalEdgeNow>0?"over":"under");
  const totalMarketSide=totalMove==null||totalMove===0?null:(totalMove>0?"over":"under");
  const totalConfirmation=totalSide&&totalMarketSide?(totalSide===totalMarketSide?"CONFIRMS":"OPPOSES"):null;

  return {
    source:a.provider||null,
    immutableHistoryAvailable:Boolean(a.historyAvailable),
    opening:{
      spread:finite(spreadOpen?.line),
      total:finite(totalOpen?.line),
      spreadTimestamp:spreadOpen?.providerTimestamp||spreadOpen?.collectedAt||null,
      totalTimestamp:totalOpen?.providerTimestamp||totalOpen?.collectedAt||null,
    },
    current:{
      spread:currentSpread,total:currentTotal,
      observedAt:a.observedAt||a.collectedAt||null,
    },
    movement:{
      spreadDelta:round(spreadMove),totalDelta:round(totalMove),
      spreadVelocityPerHour:round(slopePerHour(spreadRows)),
      totalVelocityPerHour:round(slopePerHour(totalRows)),
      spreadPersistence:round(persistence(spreadMoveSigns)),
      totalPersistence:round(persistence(totalMoveSigns)),
      spreadReversal:reversal(spreadMoveSigns),
      totalReversal:reversal(totalMoveSigns),
    },
    public:{
      ticketPct:ticket,moneyPct:money,divergencePct:round(divergence),
    },
    confirmation:{
      spread:spreadConfirmation,total:totalConfirmation,
    },
    edgeTrajectory:{
      spreadOpen:round(spreadEdgeOpen),spreadCurrent:round(spreadEdgeNow),
      spreadExpansion:spreadEdgeOpen==null||spreadEdgeNow==null?null:round(Math.abs(spreadEdgeNow)-Math.abs(spreadEdgeOpen)),
      totalOpen:round(totalEdgeOpen),totalCurrent:round(totalEdgeNow),
      totalExpansion:totalEdgeOpen==null||totalEdgeNow==null?null:round(Math.abs(totalEdgeNow)-Math.abs(totalEdgeOpen)),
    },
    closeUsedAsDecisionInput:false,
    actionMayCreateBet:false,
  };
}

export function decomposeNflProjection(game={},projection={}){
  const d=projection.decomposition||{};
  const home=d.home||{},away=d.away||{};
  const availability=game.availabilityImpact||projection.availabilityImpact||null;
  const factor=(label,h,a)=>({label,home:h??null,away:a??null,differential:finite(h)!=null&&finite(a)!=null?round(Number(h)-Number(a)):null});
  return [
    factor("Team power / efficiency",home.teamPower,away.teamPower),
    factor("QB",home.qb?.value??home.qb,away.qb?.value??away.qb),
    factor("Next Gen tracking",home.tracking?.value??home.tracking,away.tracking?.value??away.tracking),
    factor("Pass matchup",home.matchup?.pass,away.matchup?.pass),
    factor("Rush matchup",home.matchup?.rush,away.matchup?.rush),
    factor("Explosiveness",home.matchup?.explosive,away.matchup?.explosive),
    factor("Pressure / protection",home.matchup?.pressure,away.matchup?.pressure),
    factor("Trenches",home.matchup?.trenches,away.matchup?.trenches),
    factor("Special teams",home.specialTeams,away.specialTeams),
    factor("Context / rest / travel / weather",home.context,away.context),
    factor("Home field",home.hfa,away.hfa),
    availability?{
      label:"Injuries / availability",
      home:availability.homeScoreAdjustment??null,
      away:availability.awayScoreAdjustment??null,
      differential:finite(availability.marginAdjustment),
      criticalUnresolved:Boolean(availability.criticalUnresolved),
      stale:Boolean(availability.stale),
    }:null,
  ].filter(Boolean);
}

function rawConfidence({
  probability,breakEven,ev,uncertainty,coverage,dataQuality,confirmation,historicalReliability
}={}){
  const p=finite(probability),be=finite(breakEven),e=finite(ev);
  const probEdge=p!=null&&be!=null?Math.max(0,p-be):0;
  const evScore=e==null?0:clamp(e/0.12,0,1);
  const probScore=clamp(probEdge/0.10,0,1);
  const coverageScore=clamp(finite(coverage)??0.5,0,1);
  const qualityScore=clamp((finite(dataQuality)??70)/100,0,1);
  const uncertaintyScore=clamp(1-(finite(uncertainty)??14)/25,0,1);
  const hist=finite(historicalReliability);
  const histScore=hist==null?0.5:clamp(hist,0,1);
  const marketScore=confirmation==="CONFIRMS"?0.65:confirmation==="OPPOSES"?0.35:0.5;
  return Math.round(100*(
    .25*probScore+
    .20*evScore+
    .15*uncertaintyScore+
    .15*coverageScore+
    .10*qualityScore+
    .10*histScore+
    .05*marketScore
  ));
}

function calibrationFor(score,calibration){
  const bins=Array.isArray(calibration?.bins)?calibration.bins:[];
  const bin=bins.find(b=>score>=Number(b.min)&&score<=Number(b.max));
  return bin||null;
}
export function validateConfidenceCalibration(calibration={}){
  const bins=(calibration.bins||[]).slice().sort((a,b)=>Number(a.min)-Number(b.min));
  if(!calibration.validated||bins.length<3)return{ok:false,reason:"confidence-calibration-not-validated"};
  let prev=-Infinity;
  for(const b of bins){
    const rate=finite(b.winRate);
    const n=finite(b.n);
    if(rate==null||n==null||n<25)return{ok:false,reason:"confidence-bin-insufficient"};
    if(rate+1e-9<prev)return{ok:false,reason:"confidence-not-monotonic"};
    prev=rate;
  }
  return{ok:true,reason:null};
}

function candidate({
  market,selection,line,price,probability,projection,sigma,book,intel,game,calibration
}){
  const be=americanBreakEven(price),ev=expectedValuePerUnitRisk(probability,price);
  const raw=rawConfidence({
    probability,breakEven:be,ev,uncertainty:sigma,
    coverage:projection.coverage?.share,
    dataQuality:game.quality?.score??game.dataQuality,
    confirmation:market==="spread"?intel.confirmation.spread:intel.confirmation.total,
    historicalReliability:null,
  });
  const calibrationState=validateConfidenceCalibration(calibration);
  const bin=calibrationState.ok?calibrationFor(raw,calibration):null;
  const confidence=calibrationState.ok?clamp(Math.round(bin?.calibratedScore??raw),0,100):raw;

  const reasons=[];
  if(line==null)reasons.push("market-line-missing");
  if(price==null)reasons.push("actual-price-missing");
  if(probability==null)reasons.push("probability-unavailable");
  if(be==null)reasons.push("break-even-unavailable");
  if(ev==null)reasons.push("ev-unavailable");
  if(ev!=null&&ev<=0)reasons.push("non-positive-ev");
  if(!calibrationState.ok)reasons.push(calibrationState.reason);
  if(game.availabilityImpact?.criticalUnresolved)reasons.push("critical-availability-unresolved");
  if(game.availabilityImpact?.configured && game.availabilityImpact?.stale)reasons.push("availability-stale");
  if(!projection.coverage||Number(projection.coverage.share||0)<0.55)reasons.push("projection-coverage-low");

  const evGate=ev!=null&&ev>=Number(calibration?.minEv??0.025);
  const probGate=probability!=null&&be!=null&&(probability-be)>=Number(calibration?.minProbabilityEdge??0.02);
  const confidenceGate=calibrationState.ok&&confidence>=Number(calibration?.minConfidence??70);
  // Qualification is deliberately separate from staking authorization.
  // A validated independent NFL model may qualify a market when price/edge/data gates pass
  // even while confidence monotonicity and staking rules are still accumulating.
  const qualificationEligible=evGate&&probGate&&reasons.filter(r=>[
    "market-line-missing","actual-price-missing","probability-unavailable","break-even-unavailable","ev-unavailable",
    "critical-availability-unresolved","availability-stale","projection-coverage-low"
  ].includes(r)).length===0;
  const bet=qualificationEligible;

  return {
    market,selection,line,americanPrice:price,book,
    projectedValue:market==="spread"?-Number(projection.margin):Number(projection.total),
    probability:round(probability,5),
    breakEvenProbability:round(be,5),
    probabilityEdge:probability==null||be==null?null:round(probability-be,5),
    expectedValuePerUnitRisk:round(ev,5),
    uncertaintySigma:finite(sigma),
    rawConfidenceScore:raw,
    confidenceScore:confidence,
    confidenceValidated:calibrationState.ok,
    confidenceBin:bin||null,
    decision:bet?"BET":"PASS",
    qualificationEligible,
    canQualify:qualificationEligible,
    canAuthorizeWager:false,
    confidenceGatePassed:confidenceGate,
    stakeUnits:null,
    stakingValidated:false,
    reasons,
    marketIntelligence:{
      confirmation:market==="spread"?intel.confirmation.spread:intel.confirmation.total,
      edgeTrajectory:market==="spread"?{
        open:intel.edgeTrajectory.spreadOpen,current:intel.edgeTrajectory.spreadCurrent,expansion:intel.edgeTrajectory.spreadExpansion
      }:{
        open:intel.edgeTrajectory.totalOpen,current:intel.edgeTrajectory.totalCurrent,expansion:intel.edgeTrajectory.totalExpansion
      },
      actionMayCreateBet:false,
    },
  };
}

export function evaluateNflGameWagers(game={},calibration={}, {decisionAt=Date.now()}={}){
  const projection=game.nflProShadow;
  if(String(game.sport||"").toLowerCase()!=="nfl"||!projection?.ok||projection.independent!==true||projection.marketInformed===true){
    return {version:NFL_WAGER_DECISION_VERSION,ok:false,reason:"independent-nfl-projection-unavailable",candidates:[]};
  }
  const market=pickExecution(game);
  const intel=buildNflWagerIntelligence(game,projection,{decisionAt});
  const candidates=[];
  if(market.spread!=null){
    candidates.push(candidate({market:"spread",selection:"home",line:market.spread,price:market.homeSpreadPrice,probability:coverProbability(projection.margin,projection.sigmaMargin,market.spread,"home"),projection,sigma:projection.sigmaMargin,book:market.book,intel,game,calibration}));
    candidates.push(candidate({market:"spread",selection:"away",line:-market.spread,price:market.awaySpreadPrice,probability:coverProbability(projection.margin,projection.sigmaMargin,market.spread,"away"),projection,sigma:projection.sigmaMargin,book:market.book,intel,game,calibration}));
  }
  if(market.total!=null){
    candidates.push(candidate({market:"total",selection:"over",line:market.total,price:market.overPrice,probability:totalProbability(projection.total,projection.sigmaTotal,market.total,"over"),projection,sigma:projection.sigmaTotal,book:market.book,intel,game,calibration}));
    candidates.push(candidate({market:"total",selection:"under",line:market.total,price:market.underPrice,probability:totalProbability(projection.total,projection.sigmaTotal,market.total,"under"),projection,sigma:projection.sigmaTotal,book:market.book,intel,game,calibration}));
  }
  const ranked=candidates.slice().sort((a,b)=>(b.expectedValuePerUnitRisk??-99)-(a.expectedValuePerUnitRisk??-99));
  const best=ranked[0]||null;
  return {
    version:NFL_WAGER_DECISION_VERSION,
    ok:true,
    modelId:projection.modelId,
    modelVersion:projection.version,
    independentProjection:{
      home:projection.home,away:projection.away,margin:projection.margin,total:projection.total,
      sigmaMargin:projection.sigmaMargin,sigmaTotal:projection.sigmaTotal,
      distribution:"normal-approximation",
      marketInformed:false,
    },
    decomposition:decomposeNflProjection(game,projection),
    executionMarket:{...market},
    wagerIntelligence:intel,
    candidates:ranked,
    bestWager:best,
    decision:best?.decision||"PASS",
    confidenceScore:best?.confidenceScore??null,
    confidenceValidated:Boolean(best?.confidenceValidated),
    canQualify:Boolean(best?.qualificationEligible),
    canAuthorizeWager:false,
    staking:{validated:false,units:null,reason:"staking-rules-not-validated"},
    closeUsedAsDecisionInput:false,
    objective:"positive-expected-value-at-offered-price",
  };
}

export function attachNflWagerDecisions(games=[],calibration={}){
  return (games||[]).map(game=>{
    if(String(game?.sport||"").toLowerCase()!=="nfl")return game;
    return {...game,nflWagerDecision:evaluateNflGameWagers(game,calibration)};
  });
}
