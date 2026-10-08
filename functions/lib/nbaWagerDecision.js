import {currentActionRows, actionTimestampMs} from './actionTemporalValidity.js';
import { pGreater } from "./metrics.js";
import { expectedValue } from "./nbaQualification.js";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,d=4)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};

export function americanBreakEven(price){
  const p=finite(price);
  if(p==null||p===0)return null;
  return p>0?100/(p+100):Math.abs(p)/(Math.abs(p)+100);
}

export function decomposeNbaDisagreement(projection={}){
  const d=projection.decomposition||{};
  const home=d.home||{},away=d.away||{};
  const factors=[];
  const poss=finite(projection.expectedPossessions)||99.5;
  const push=(factor,homeValue,awayValue,marginImpact,totalImpact,source="MODEL_COMPONENT",direct=true)=>{
    factors.push({
      factor,
      homeValue:finite(homeValue),
      awayValue:finite(awayValue),
      estimatedMarginImpact:round(marginImpact,3),
      estimatedTotalImpact:round(totalImpact,3),
      source,
      directModelContribution:direct
    });
  };
  const league=114.5;
  const hOff=((finite(home.off)??league)-league)*0.56*poss/100;
  const aOff=((finite(away.off)??league)-league)*0.56*poss/100;
  const oppDefHome=((finite(away.def)??league)-league)*0.44*poss/100;
  const oppDefAway=((finite(home.def)??league)-league)*0.44*poss/100;
  push("offensive_efficiency",home.off,away.off,hOff-aOff,hOff+aOff);
  push("defensive_efficiency",home.def,away.def,oppDefHome-oppDefAway,oppDefHome+oppDefAway);
  const avgEff=league+
    ((((finite(home.off)??league)-league)+((finite(away.off)??league)-league))/2)*.56+
    ((((finite(home.def)??league)-league)+((finite(away.def)??league)-league))/2)*.44;
  const paceTotal=((poss-99.5)*2*avgEff)/100;
  push("pace",home.pace,away.pace,0,paceTotal);
  const hr=finite(d.homeRest?.pts)||0,ar=finite(d.awayRest?.pts)||0;
  push("rest_fatigue",d.homeRest?.pts,d.awayRest?.pts,hr-ar,hr+ar);
  const ha=finite(d.homeAvailability?.points)||0,aa=finite(d.awayAvailability?.points)||0;
  push("availability",d.homeAvailability?.points,d.awayAvailability?.points,ha-aa,ha+aa);
  push("home_court",finite(d.hca),0,finite(d.hca)||0,0);
  for(const [factor,key] of [["effective_fg","efg"],["turnover_rate","tov"],["offensive_rebound_rate","orb"],["free_throw_rate","ftr"]]){
    if(finite(home[key])!=null||finite(away[key])!=null)push(factor,home[key],away[key],null,null,"CONTEXT_DIAGNOSTIC",false);
  }
  return {
    factors,
    directEstimatedMarginImpact:round(factors.filter(x=>x.directModelContribution&&x.estimatedMarginImpact!=null).reduce((s,x)=>s+x.estimatedMarginImpact,0),3),
    directEstimatedTotalImpact:round(factors.filter(x=>x.directModelContribution&&x.estimatedTotalImpact!=null).reduce((s,x)=>s+x.estimatedTotalImpact,0),3),
    note:"Only factors with explicit model coefficients receive numeric impact. Context diagnostics are displayed without invented weights."
  };
}

function linearSlope(points=[]){
  if(points.length<2)return null;
  const x0=Date.parse(points[0].observedAt);
  const xs=points.map(p=>(Date.parse(p.observedAt)-x0)/3600000);
  const ys=points.map(p=>finite(p.line)).filter(v=>v!=null);
  if(ys.length!==points.length)return null;
  const xm=xs.reduce((a,b)=>a+b,0)/xs.length,ym=ys.reduce((a,b)=>a+b,0)/ys.length;
  const den=xs.reduce((s,x)=>s+(x-xm)**2,0);
  return den?xs.reduce((s,x,i)=>s+(x-xm)*(ys[i]-ym),0)/den:null;
}

export function deriveNbaMarketTrajectory(rows=[],{marketType,side,projectionValue=null,decisionAt=null}={}){
  const cutoff=decisionAt?Date.parse(decisionAt):Infinity;
  const xs=(rows||[])
    .filter(r=>String(r.marketType||r.market||"").toLowerCase()===String(marketType||"").toLowerCase())
    .filter(r=>!side||String(r.side||r.selection||"").toUpperCase()===String(side).toUpperCase())
    .map(r=>({line:finite(r.line),price:finite(r.price??r.americanPrice),observedAt:r.observedAt||r.capturedAt||r.collectedAt,snapshotType:r.snapshotType||null}))
    .filter(r=>r.observedAt&&Date.parse(r.observedAt)<=cutoff)
    .sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  if(!xs.length)return {available:false,points:0};
  const open=xs.find(r=>r.snapshotType==="OPEN")||xs[0],current=xs.at(-1);
  const move=open.line!=null&&current.line!=null?current.line-open.line:null;
  const slope=linearSlope(xs);
  let reversals=0,lastSign=0;
  for(let i=1;i<xs.length;i++){
    if(xs[i].line==null||xs[i-1].line==null)continue;
    const d=xs[i].line-xs[i-1].line,sign=Math.sign(d);
    if(sign&&lastSign&&sign!==lastSign)reversals++;
    if(sign)lastSign=sign;
  }
  let persistence=null;
  if(move!=null&&xs.length>1){
    const dir=Math.sign(move);
    const aligned=xs.slice(1).filter((r,i)=>r.line!=null&&xs[i].line!=null&&Math.sign(r.line-xs[i].line)===dir).length;
    persistence=dir===0?1:aligned/(xs.length-1);
  }
  let confirmsFbis=null,edgeExpansion=null;
  const proj=finite(projectionValue);
  const marketTarget=(row)=>{
    const ln=finite(row?.line);
    if(ln==null)return null;
    if(String(marketType||"").toLowerCase()==="spread"){
      return String(side||"").toUpperCase()==="HOME" ? -ln : ln;
    }
    if(String(marketType||"").toLowerCase()==="total") return ln;
    return null;
  };
  const openTarget=marketTarget(open),currentTarget=marketTarget(current);
  if(proj!=null&&openTarget!=null&&currentTarget!=null){
    const openEdge=proj-openTarget,currentEdge=proj-currentTarget;
    edgeExpansion=round(Math.abs(currentEdge)-Math.abs(openEdge),3);
    confirmsFbis=Math.abs(currentEdge)<Math.abs(openEdge);
  }
  return {
    available:true,points:xs.length,open,current,lineMove:round(move,3),movementVelocityPerHour:round(slope,4),
    persistence:round(persistence,4),reversals,confirmsFbis,edgeExpansion,history:xs
  };
}

export function summarizeActionForDecision(rows=[],{decisionAt=new Date().toISOString(),marketType=null,side=null,fbisDirection=null}={}){
  const cutoff=decisionAt?Date.parse(decisionAt):Infinity;
  const alias=v=>{const s=String(v||"").toLowerCase();return s==="ml"?"moneyline":s;};
  const wanted=alias(marketType);
  const xs=currentActionRows(rows||[],{now:decisionAt})
    .filter(r=>!marketType||alias(r.market_type||r.marketType||"")===wanted)
    .filter(r=>!side||String(r.selection||r.side||"").toUpperCase()===String(side).toUpperCase())
    .filter(r=>Date.parse(r.provider_timestamp||r.collected_at||r.observedAt||0)<=cutoff)
    .sort((a,b)=>actionTimestampMs(a.provider_timestamp||a.collected_at)-actionTimestampMs(b.provider_timestamp||b.collected_at));
  if(!xs.length)return {available:false,role:"market_intelligence",canDirectlyQualify:false,canAuthorize:false};
  const latest=xs.at(-1);
  const ticket=finite(latest.public_ticket_pct),money=finite(latest.public_money_pct);
  const divergence=ticket!=null&&money!=null?money-ticket:null;
  const open=xs.find(x=>String(x.snapshot_type||"").toUpperCase()==="OPEN")||xs[0];
  const movement=(finite(latest.line)!=null&&finite(open.line)!=null)?finite(latest.line)-finite(open.line):null;
  const m=alias(marketType),selected=String(side||"").toUpperCase();
  let moveTowardSelected=null;
  if(movement!=null&&movement!==0){
    if(m==="spread") moveTowardSelected=selected==="HOME"?movement<0:selected==="AWAY"?movement>0:null;
    if(m==="total") moveTowardSelected=selected==="OVER"?movement>0:selected==="UNDER"?movement<0:null;
  }
  let modelPrefersSelected=null;
  if(fbisDirection){
    modelPrefersSelected=(fbisDirection==="HOME_OR_OVER"&&["HOME","OVER"].includes(selected))||
      (fbisDirection==="AWAY_OR_UNDER"&&["AWAY","UNDER"].includes(selected));
  }
  let confirmation="NEUTRAL";
  if(moveTowardSelected!=null&&modelPrefersSelected!=null){
    confirmation=(moveTowardSelected===modelPrefersSelected)?"CONFIRMS_FBIS":"OPPOSES_FBIS";
  }
  const publicOnSelected=ticket!=null?ticket>50:null;
  const reverseLineMovement=publicOnSelected===true&&moveTowardSelected===false;
  const derivedSteamLike=movement!=null&&Math.abs(movement)>=1&&
    ((divergence!=null&&Math.abs(divergence)>=10)||finite(latest.tracked_volume)!=null);
  return {
    available:true,role:"market_intelligence",canDirectlyQualify:false,canAuthorize:false,
    snapshotCount:xs.length,latestAt:latest.provider_timestamp||latest.collected_at,
    ticketPct:ticket,moneyPct:money,moneyMinusTicketPct:round(divergence,3),
    openingLine:finite(open.line),currentLine:finite(latest.line),lineMove:round(movement,3),
    reverseLineMovement,
    derivedSteamLike,
    confirmation,
    providerSharpLabel:null,
    note:"ACTION is informational only. Reverse-line and steam-like flags are locally derived; provider sharp labels are not promoted to FBIS truth."
  };
}

export function evaluateNbaConfidence({
  modelProbability,
  ev,
  sigma,
  matchupReliability=0.5,
  dataQuality=0.5,
  historicalReliability=0.5,
  marketConfirmation="NEUTRAL",
  calibration=null,
}={}){
  const p=finite(modelProbability),e=finite(ev),s=finite(sigma);
  const base=
    (p==null?0:clamp((p-0.5)/0.2,0,1))*30+
    (e==null?0:clamp(e/0.12,0,1))*25+
    clamp(matchupReliability,0,1)*15+
    clamp(dataQuality,0,1)*15+
    clamp(historicalReliability,0,1)*15;
  const marketAdj=marketConfirmation==="CONFIRMS_FBIS"?3:marketConfirmation==="OPPOSES_FBIS"?-3:0;
  const uncertaintyPenalty=s==null?5:clamp((s-11)/8,0,1)*8;
  const provisional=Math.round(clamp(base+marketAdj-uncertaintyPenalty,0,100));
  const valid=Boolean(calibration?.monotonicityPass)&&Number(calibration?.sampleN)>=50;
  return {
    score:provisional,
    status:valid?"CALIBRATED":"PROVISIONAL",
    decisionEligible:valid,
    sampleN:Number(calibration?.sampleN||0),
    monotonicityPass:Boolean(calibration?.monotonicityPass),
    note:valid?null:"Confidence cannot drive staking until empirical monotonicity is demonstrated."
  };
}

export function buildNbaWagerDecision({
  projection,
  offer,
  trajectoryRows=[],
  actionRows=[],
  matchupReliability=0.5,
  dataQuality=0.5,
  historicalReliability=0.5,
  confidenceCalibration=null,
  decisionAt=new Date().toISOString(),
  qualificationPolicy={minProbability:0.56,minEv:0.02,minReliability:0.55,maxSigma:17},
}={}){
  if(!projection?.ok&&projection?.margin==null)return {ok:false,reason:"projection_missing"};
  const marketType=String(offer?.marketType||"").toLowerCase(),side=String(offer?.side||"").toUpperCase();
  const line=finite(offer?.line),price=finite(offer?.price);
  const margin=finite(projection.margin),total=finite(projection.total);
  const sigma=marketType==="total"?finite(projection.sigmaTotal):finite(projection.sigmaMargin);
  let prob=null,projValue=null,fbisDirection=null;
  if(marketType==="spread"&&line!=null&&sigma!=null){
    projValue=margin;
    prob=side==="HOME"?pGreater(margin,-line,sigma):1-pGreater(margin,line,sigma);
    fbisDirection=margin>=-line?"HOME_OR_OVER":"AWAY_OR_UNDER";
  }else if(marketType==="total"&&line!=null&&sigma!=null){
    projValue=total;
    prob=side==="OVER"?pGreater(total,line,sigma):1-pGreater(total,line,sigma);
    fbisDirection=total>=line?"HOME_OR_OVER":"AWAY_OR_UNDER";
  }else if(marketType==="ml"){
    const ph=finite(projection.pHomeWin);
    prob=side==="HOME"?ph:(ph==null?null:1-ph);
    projValue=margin;
    fbisDirection=margin>=0?"HOME_OR_OVER":"AWAY_OR_UNDER";
  }
  const breakEven=americanBreakEven(price),ev=expectedValue(prob,price);
  const trajectory=deriveNbaMarketTrajectory(trajectoryRows,{marketType,side,projectionValue:projValue,decisionAt});
  const freshnessMinutes=trajectory?.current?.observedAt
    ? Math.max(0,(Date.parse(decisionAt)-Date.parse(trajectory.current.observedAt))/60000)
    : null;
  const action=summarizeActionForDecision(actionRows,{decisionAt,marketType,side,fbisDirection});
  const marketConfirmation=action.available?action.confirmation:(trajectory.confirmsFbis===true?"CONFIRMS_FBIS":trajectory.confirmsFbis===false?"OPPOSES_FBIS":"NEUTRAL");
  const confidence=evaluateNbaConfidence({modelProbability:prob,ev,sigma,matchupReliability,dataQuality,historicalReliability,marketConfirmation,calibration:confidenceCalibration});
  const reasons=[];
  if(prob==null)reasons.push("probability_missing");
  if(price==null)reasons.push("price_missing");
  if(prob!=null&&prob<qualificationPolicy.minProbability)reasons.push("probability_below_gate");
  if(ev==null||ev<qualificationPolicy.minEv)reasons.push("ev_below_gate");
  if(matchupReliability<qualificationPolicy.minReliability)reasons.push("matchup_reliability_below_gate");
  if(sigma!=null&&sigma>qualificationPolicy.maxSigma)reasons.push("uncertainty_above_gate");
  if(freshnessMinutes!=null&&freshnessMinutes>180)reasons.push("market_snapshot_stale");
  if(offer?.preTip===false)reasons.push("post_tip_offer");
  if(offer?.pairedMarket===false)reasons.push("unpaired_market");
  const bet=reasons.length===0;
  return {
    ok:true,
    decisionAt,
    marketType,side,line,price,
    projection:{home:projection.home,away:projection.away,margin,total,expectedPossessions:projection.expectedPossessions,sigma,modelId:projection.modelId,modelVersion:projection.modelVersion},
    disagreement:decomposeNbaDisagreement(projection),
    modelProbability:round(prob,6),
    breakEvenProbability:round(breakEven,6),
    probabilityEdge:prob!=null&&breakEven!=null?round(prob-breakEven,6):null,
    expectedValue:round(ev,6),
    projectionUncertainty:sigma,
    matchupReliability:round(matchupReliability,4),
    dataQuality:round(dataQuality,4),
    dataFreshnessMinutes:round(freshnessMinutes,2),
    historicalFactorReliability:round(historicalReliability,4),
    marketTrajectory:trajectory,
    actionIntelligence:action,
    marketConfirmation,
    confidence,
    decision:bet?"BET":"PASS",
    qualificationEligible:bet,
    stakeUnits:null,
    stakeStatus:"UNVALIDATED",
    reasons,
    safeguards:{independentProjectionMarketFree:true,closeUsedAsInput:false,actionDirectQualifier:false,actionAuthorizer:false}
  };
}
