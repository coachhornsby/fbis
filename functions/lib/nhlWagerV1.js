/**
 * NHL-WAGER-v1 — market-aware research decision layer.
 *
 * Independent NHL projections remain market-free. This module consumes the
 * finished projection plus offered prices and optional ACTION trajectory after
 * projection time. It prices each offered wager, decomposes disagreement,
 * produces provisional confidence, and stays fail-closed on wager authority
 * until prospective calibration/ROI evidence clears governance.
 */

import { americanToImplied, expectedRoi, twoWayMarket } from "./pricing.js";

export const NHL_WAGER_V1_ID = "NHL-WAGER-v1";
export const NHL_WAGER_V1_VERSION = "research-v1.0-game-level-ev";
export const NHL_WAGER_CONFIDENCE_VERSION = "nhl-wager-confidence-v1-provisional";

function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function round(v,n=4){if(v==null||!Number.isFinite(Number(v)))return null;const p=10**n;return Math.round(Number(v)*p)/p;}
function logit(p){const q=clamp(Number(p),1e-6,1-1e-6);return Math.log(q/(1-q));}
function sigmoid(z){return z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));}
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}

export function nhlMarketDistribution(homeGoals,awayGoals,{totalLine=null,homeSpread=null}={}){
  const h=finite(homeGoals),a=finite(awayGoals);
  if(h==null||a==null)return null;
  const shared=Math.min(.32,.10*Math.min(h,a)),lh=Math.max(.05,h-shared),la=Math.max(.05,a-shared);
  let homeReg=0,awayReg=0,tie=0,over=0,under=0,pushTotal=0,homeCover=0,awayCover=0,pushSpread=0,mass=0;
  for(let x=0;x<=12;x++)for(let y=0;y<=12;y++)for(let z=0;z<=5;z++){
    const p=poisson(lh,x)*poisson(la,y)*poisson(shared,z),hg=x+z,ag=y+z;mass+=p;
    if(hg>ag)homeReg+=p;else if(ag>hg)awayReg+=p;else tie+=p;
    if(totalLine!=null){
      const t=hg+ag;if(t>totalLine)over+=p;else if(t<totalLine)under+=p;else pushTotal+=p;
    }
    if(homeSpread!=null){
      const d=hg+homeSpread-ag;if(d>0)homeCover+=p;else if(d<0)awayCover+=p;else pushSpread+=p;
    }
  }
  const norm=v=>mass?clamp(v/mass,0,1):0;
  const otHome=1/(1+Math.exp(-(h-a)/.65));
  const homeWin=norm(homeReg)+norm(tie)*otHome;
  const renormNoPush=(x,y)=>{const s=x+y;return s>0?x/s:null;};
  const hc=norm(homeCover),ac=norm(awayCover),ov=norm(over),un=norm(under);
  return {
    homeWinIncludingOt:round(homeWin),awayWinIncludingOt:round(1-homeWin),
    homeCover:homeSpread==null?null:round(renormNoPush(hc,ac)),
    awayCover:homeSpread==null?null:round(renormNoPush(ac,hc)),
    over:totalLine==null?null:round(renormNoPush(ov,un)),
    under:totalLine==null?null:round(renormNoPush(un,ov)),
    spreadPush:homeSpread==null?null:round(norm(pushSpread)),
    totalPush:totalLine==null?null:round(norm(pushTotal)),
    sharedComponent:round(shared,3),
  };
}

function oddsPack(game={}){
  const o=game.odds||{};
  const homeMl=finite(o.pinHomeMl??o.fairHomeMl??o.homeMl);
  const awayMl=finite(o.pinAwayMl??o.fairAwayMl??o.awayMl);
  const homeSpread=finite(o.pinSpread??o.spread);
  const homeSpreadPrice=finite(o.pinSpreadHomePrice??o.softSpreadHomePrice??o.spreadPrice);
  const awaySpreadPrice=finite(o.pinSpreadAwayPrice??o.softSpreadAwayPrice);
  const total=finite(o.pinTotal??o.total);
  const overPrice=finite(o.pinOverPrice??o.softOverPrice);
  const underPrice=finite(o.pinUnderPrice??o.softUnderPrice);
  return {homeMl,awayMl,homeSpread,homeSpreadPrice,awaySpreadPrice,total,overPrice,underPrice};
}

function marketFamily(v){
  const s=String(v||"").toLowerCase();
  if(s.includes("spread")||s==="rl"||s==="puck_line")return"spread";
  if(s.includes("total")||s==="ou")return"total";
  if(s.includes("money")||s==="ml"||s==="h2h")return"moneyline";
  return s;
}
function sideMatch(selection,wanted){
  const s=String(selection||"").toLowerCase();
  const w=String(wanted||"").toLowerCase();
  if(w==="home")return s==="home"||s==="h"||s.includes("home");
  if(w==="away")return s==="away"||s==="a"||s.includes("away");
  if(w==="over")return s==="over"||s==="o";
  if(w==="under")return s==="under"||s==="u";
  return s===w;
}

export function deriveNhlMarketTrajectory(actionIntel,{market,selection,fbisSide=null}={}){
  const rows=(actionIntel?.lineHistory||[]).filter(r=>marketFamily(r.market)===marketFamily(market)&&sideMatch(r.selection,selection))
    .slice().sort((a,b)=>String(a.collectedAt||a.providerTimestamp||"").localeCompare(String(b.collectedAt||b.providerTimestamp||"")));
  if(!rows.length){
    const split=(actionIntel?.publicSplits?.markets||[]).find(x=>{
      const m=String(x.market||"").toUpperCase();
      return (market==="moneyline"&&m==="ML")||(market==="spread"&&m==="RL")||(market==="total"&&m==="TOTAL");
    })||null;
    return {
      available:false,observations:0,openingLine:null,currentLine:null,lineMove:null,
      openingPrice:null,currentPrice:null,priceMove:null,velocityPerHour:null,
      persistence:null,reversal:false,ticketPct:finite(split?.ticketPct),moneyPct:finite(split?.moneyPct),
      moneyMinusTicket:finite(split?.moneyTicketGap),marketConfirmation:null,edgeTrajectory:null
    };
  }
  const first=rows[0],last=rows.at(-1);
  const openLine=finite(first.line),currentLine=finite(last.line),openPrice=finite(first.americanPrice),currentPrice=finite(last.americanPrice);
  const lineMove=openLine!=null&&currentLine!=null?currentLine-openLine:null;
  const priceMove=openPrice!=null&&currentPrice!=null?currentPrice-openPrice:null;
  const t0=Date.parse(first.collectedAt||first.providerTimestamp||""),t1=Date.parse(last.collectedAt||last.providerTimestamp||"");
  const hours=Number.isFinite(t0)&&Number.isFinite(t1)&&t1>t0?(t1-t0)/3600000:null;
  const velocity=hours&&lineMove!=null?lineMove/hours:null;
  const deltas=[];
  for(let i=1;i<rows.length;i++){
    const a=finite(rows[i-1].line),b=finite(rows[i].line);if(a!=null&&b!=null&&a!==b)deltas.push(Math.sign(b-a));
  }
  const reversal=deltas.some((d,i)=>i>0&&d!==deltas[i-1]);
  const persistence=deltas.length?Math.abs(deltas.reduce((s,x)=>s+x,0))/deltas.length:null;
  const split=(actionIntel?.publicSplits?.markets||[]).find(x=>{
    const m=String(x.market||"").toUpperCase();
    return (market==="moneyline"&&m==="ML")||(market==="spread"&&m==="RL")||(market==="total"&&m==="TOTAL");
  })||null;
  let confirmation=null;
  if(lineMove!=null&&fbisSide){
    const favDirection=(market==="total")
      ? (String(fbisSide).toUpperCase()==="OVER"?1:-1)
      : (String(fbisSide).toUpperCase()==="HOME"?-1:1);
    confirmation=lineMove===0?"NEUTRAL":Math.sign(lineMove)===favDirection?"CONFIRMS_FBIS":"OPPOSES_FBIS";
  }
  return {
    available:true,observations:rows.length,
    openingLine:openLine,currentLine, lineMove:round(lineMove),
    openingPrice:openPrice,currentPrice,priceMove:round(priceMove),
    velocityPerHour:round(velocity,5),persistence:round(persistence),reversal,
    ticketPct:finite(split?.ticketPct),moneyPct:finite(split?.moneyPct),
    moneyMinusTicket:finite(split?.moneyTicketGap),marketConfirmation:confirmation,
    snapshots:{open:first,current:last}
  };
}

export function decomposeNhlProjectionDisagreement(game={}){
  const p=game.nhlProV2||game.challengers?.["NHL-PRO-v2"]||{};
  const l=p.layers||{};
  const home=p.home||game.home?.abbr||"HOME",away=p.away||game.away?.abbr||"AWAY";
  const xgHome=finite(l.eventChainXg?.home),xgAway=finite(l.eventChainXg?.away);
  const gHome=finite(l.goalie?.home?.impactPerShot),gAway=finite(l.goalie?.away?.impactPerShot);
  const finHome=finite(l.finishing?.home?.factor),finAway=finite(l.finishing?.away?.factor);
  const stHome=finite(l.specialTeams?.home),stAway=finite(l.specialTeams?.away);
  const restHome=finite(l.situation?.homeRestDays),restAway=finite(l.situation?.awayRestDays);
  const elo=finite(l.situation?.eloGoalAdjustment);
  const trHome=finite(l.tracking?.home?.goals),trAway=finite(l.tracking?.away?.goals);
  const pt=l.tracking?.player?.home?.differential||{};
  const factors=[
    {factor:"5v5/event-chain xG",homeImpact:xgHome,awayImpact:xgAway,marginImpact:xgHome!=null&&xgAway!=null?xgHome-xgAway:null,source:"NHL_PRO_V2_EVENT_CHAIN"},
    {factor:"goalie",homeImpact:gAway==null?null:-gAway*30,awayImpact:gHome==null?null:-gHome*30,marginImpact:gHome!=null&&gAway!=null?(-gAway*30)-(-gHome*30):null,source:"NHL_PRO_V2_GOALIE"},
    {factor:"finishing",homeImpact:finHome==null?null:(finHome-1)*.70,awayImpact:finAway==null?null:(finAway-1)*.70,marginImpact:finHome!=null&&finAway!=null?(finHome-finAway)*.70:null,source:"NHL_PRO_V2_FINISHING"},
    {factor:"special teams",homeImpact:stHome,awayImpact:stAway,marginImpact:stHome!=null&&stAway!=null?stHome-stAway:null,source:"NHL_PRO_V2_SPECIAL_TEAMS"},
    {factor:"team EDGE zone pressure",homeImpact:trHome,awayImpact:trAway,marginImpact:trHome!=null&&trAway!=null?trHome-trAway:null,source:"NHL_EDGE_ADVISORY"},
    {factor:"rest",homeImpact:restHome,awayImpact:restAway,marginImpact:restHome!=null&&restAway!=null?restHome-restAway:null,source:"SITUATIONAL_DAYS"},
    {factor:"elo/form",homeImpact:elo==null?null:elo/2,awayImpact:elo==null?null:-elo/2,marginImpact:elo,source:"NHL_PRO_V2_FORM_ELO"},
    {factor:"player tracking speed differential",homeImpact:finite(pt.maxSkatingSpeed),awayImpact:null,marginImpact:null,source:"NHL_EDGE_PLAYER_ADVISORY"},
    {factor:"player tracking shot-speed differential",homeImpact:finite(pt.maxShotSpeed),awayImpact:null,marginImpact:null,source:"NHL_EDGE_PLAYER_ADVISORY"},
    {factor:"player tracking high-danger differential",homeImpact:finite(pt.highDangerShots),awayImpact:null,marginImpact:null,source:"NHL_EDGE_PLAYER_ADVISORY"},
  ].filter(x=>x.homeImpact!=null||x.awayImpact!=null||x.marginImpact!=null);
  return {
    home,away,
    projectedMargin:finite(p.margin??(finite(p.projHome)!=null&&finite(p.projAway)!=null?finite(p.projHome)-finite(p.projAway):null)),
    projectedTotal:finite(p.total??(finite(p.projHome)!=null&&finite(p.projAway)!=null?finite(p.projHome)+finite(p.projAway):null)),
    factors,
    diagnosticApproximation:true,
    note:"Attribution is diagnostic. Only fields already used by NHL-PRO-v2 affect the independent projection; player EDGE remains advisory until prospective evidence clears it."
  };
}

function reliabilityForGame(game={},trajectory=null){
  const p=game.nhlProV2||{};
  const goalie=p.layers?.goalie||{};
  const goalieReliability=[finite(goalie.home?.reliability),finite(goalie.away?.reliability)].filter(x=>x!=null);
  const goalieScore=goalieReliability.length?goalieReliability.reduce((a,b)=>a+b,0)/goalieReliability.length:.5;
  const trackingCoverage=finite(p.layers?.tracking?.playerEdgeCoverage)??0;
  const contextOk=p.ok!==false;
  const marketFresh=trajectory?.available?1:.72;
  const quality=finite(game.quality?.score??game.dataQuality??game.model?.dataQuality);
  const qualityNorm=quality==null?.75:quality>1?clamp(quality/100,0,1):clamp(quality,0,1);
  const score=clamp(.30*goalieScore+.18*clamp(trackingCoverage,0,1)+.22*qualityNorm+.20*marketFresh+.10*(contextOk?1:.4),0,1);
  return {
    score:round(score),goalie:round(goalieScore),trackingCoverage:round(trackingCoverage),
    dataQuality:round(qualityNorm),marketTrajectory:marketFresh,contextOk
  };
}
function provisionalConfidence({ev,probEdge,reliability,trajectory,marketComplete,dataFresh=true}={}){
  if(ev==null||probEdge==null||!marketComplete)return 0;
  const evScore=clamp((ev+.01)/.12,0,1);
  const edgeScore=clamp((Math.abs(probEdge)-.005)/.08,0,1);
  const rel=clamp(finite(reliability?.score)??.5,0,1);
  let market=.5;
  if(trajectory?.marketConfirmation==="CONFIRMS_FBIS")market=.72;
  else if(trajectory?.marketConfirmation==="OPPOSES_FBIS")market=.38;
  if(trajectory?.reversal)market*=.86;
  const score=100*(.34*evScore+.24*edgeScore+.26*rel+.10*market+.06*(dataFresh?1:.3));
  return Math.round(clamp(score,0,100));
}

function offerRow({market,selection,line,price,oppositePrice,modelProbability,game,fbisSide}){
  const tw=twoWayMarket(price,oppositePrice);
  const noVig=tw.complete?tw.noVigA:null;
  const breakEven=americanToImplied(price);
  const combinedIntel={...(game.actionIntel||{}),lineHistory:[...(game.marketLineHistory||[]),...(game.actionIntel?.lineHistory||[])]};
  const trajectory=deriveNhlMarketTrajectory(combinedIntel,{market,selection,fbisSide});
  const reliability=reliabilityForGame(game,trajectory);
  const calibrated=modelProbability==null?null:clamp(.5+(modelProbability-.5)*(.82+.12*reliability.score),.02,.98);
  const ev=calibrated!=null?expectedRoi(calibrated,price):null;
  const edge=calibrated!=null&&noVig!=null?calibrated-noVig:null;
  const confidence=provisionalConfidence({ev,probEdge:edge,reliability,trajectory,marketComplete:tw.complete});
  const researchBet=Boolean(ev!=null&&edge!=null&&ev>=.03&&edge>=.02&&reliability.score>=.58&&confidence>=58);
  return {
    market,selection,line:finite(line),americanPrice:finite(price),
    modelProbability:round(modelProbability),calibratedProbability:round(calibrated),
    breakEvenProbability:round(breakEven),marketNoVigProbability:round(noVig),
    probabilityEdge:round(edge),expectedValue:round(ev),expectedRoi:round(ev),
    reliability,trajectory,
    confidence,confidenceVersion:NHL_WAGER_CONFIDENCE_VERSION,
    confidenceStatus:"PROVISIONAL_UNCALIBRATED",
    decision:researchBet?"BET":"PASS",
    decisionStatus:"RESEARCH_ONLY",
    suggestedUnits:0,
    canQualify:false,canAuthorizeWager:false,
    reason:researchBet?"Positive provisional EV after reliability shrink; stake blocked pending prospective calibration.":"Price/edge/reliability/confidence gate not cleared."
  };
}

export function evaluateNhlGameWagers(game={}){
  const p=game.nhlProV2||game.challengers?.["NHL-PRO-v2"];
  const ph=finite(p?.projHome),pa=finite(p?.projAway);
  if(ph==null||pa==null)return {ok:false,reason:"independent_projection_missing",offers:[],canQualify:false,canAuthorizeWager:false};
  const o=oddsPack(game),dist=nhlMarketDistribution(ph,pa,{totalLine:o.total,homeSpread:o.homeSpread});
  const home=String(game.home?.abbr||p.home||"HOME"),away=String(game.away?.abbr||p.away||"AWAY");
  const offers=[];
  if(o.homeMl!=null&&o.awayMl!=null){
    offers.push(offerRow({market:"moneyline",selection:"home",price:o.homeMl,oppositePrice:o.awayMl,modelProbability:finite(p?.probability?.homeWinIncludingOt)??dist.homeWinIncludingOt,game,fbisSide:"HOME"}));
    offers.push(offerRow({market:"moneyline",selection:"away",price:o.awayMl,oppositePrice:o.homeMl,modelProbability:finite(p?.probability?.awayWinIncludingOt)??dist.awayWinIncludingOt,game,fbisSide:"AWAY"}));
  }
  if(o.homeSpread!=null&&o.homeSpreadPrice!=null&&o.awaySpreadPrice!=null){
    offers.push(offerRow({market:"spread",selection:"home",line:o.homeSpread,price:o.homeSpreadPrice,oppositePrice:o.awaySpreadPrice,modelProbability:dist.homeCover,game,fbisSide:"HOME"}));
    offers.push(offerRow({market:"spread",selection:"away",line:-o.homeSpread,price:o.awaySpreadPrice,oppositePrice:o.homeSpreadPrice,modelProbability:dist.awayCover,game,fbisSide:"AWAY"}));
  }
  if(o.total!=null&&o.overPrice!=null&&o.underPrice!=null){
    offers.push(offerRow({market:"total",selection:"over",line:o.total,price:o.overPrice,oppositePrice:o.underPrice,modelProbability:dist.over,game,fbisSide:"OVER"}));
    offers.push(offerRow({market:"total",selection:"under",line:o.total,price:o.underPrice,oppositePrice:o.overPrice,modelProbability:dist.under,game,fbisSide:"UNDER"}));
  }
  offers.sort((a,b)=>(b.expectedValue??-99)-(a.expectedValue??-99));
  return {
    ok:true,modelId:NHL_WAGER_V1_ID,version:NHL_WAGER_V1_VERSION,home,away,
    independentProjection:{projHome:ph,projAway:pa,margin:round(ph-pa),total:round(ph+pa),marketFree:true},
    disagreement:decomposeNhlProjectionDisagreement(game),
    offers,bestOffer:offers[0]||null,
    researchBets:offers.filter(x=>x.decision==="BET"),
    confidenceCalibrated:false,
    stakingValidated:false,
    canQualify:false,canAuthorizeWager:false,
    governance:"Research BET/PASS labels are evaluation targets only. Unit stakes remain zero until walk-forward ROI, calibration, drawdown, CLV and confidence monotonicity pass."
  };
}

export function evaluateNhlPropWagerV1(row={}){
  if(String(row.sport||"").toLowerCase()!=="nhl")return null;
  const pOver=finite(row.probabilityOver),pUnder=finite(row.probabilityUnder);
  const over=finite(row.overOdds??row.overPrice),under=finite(row.underOdds??row.underPrice);
  if(pOver==null||pUnder==null||over==null||under==null)return {
    modelId:"NHL-WAGER-PROP-v1",decision:"PASS",decisionStatus:"RESEARCH_ONLY",reason:"complete_two_way_price_or_probability_missing",
    confidence:0,confidenceStatus:"PROVISIONAL_UNCALIBRATED",suggestedUnits:0,canQualify:false,canAuthorizeWager:false
  };
  const side=pOver>=pUnder?"OVER":"UNDER",p=side==="OVER"?pOver:pUnder,price=side==="OVER"?over:under,opp=side==="OVER"?under:over;
  const tw=twoWayMarket(price,opp),noVig=tw.complete?tw.noVigA:null;
  const validated=row.validationStatus==="PROMOTE_RESEARCH"&&(!row.lineValidationStatus||row.lineValidationStatus==="PROMOTE_RESEARCH");
  const gate=row.propGate==="CLEAR"&&row.eligibleForCard!==false;
  const track=finite(row.trackingAdvisory?.coverage)??0;
  const reliabilityScore=clamp((validated?.48:.20)+(gate?.28:.05)+Math.min(.12,track*.12)+(finite(row.roleConfidence)!=null?clamp(finite(row.roleConfidence),0,1)*.12:.08),0,1);
  const calibrated=clamp(.5+(p-.5)*(.78+.14*reliabilityScore),.01,.99);
  const ev=expectedRoi(calibrated,price),edge=noVig==null?null:calibrated-noVig;
  const reliability={score:round(reliabilityScore),validatedMarket:validated,availabilityClear:gate,trackingCoverage:round(track)};
  const confidence=provisionalConfidence({ev,probEdge:edge,reliability,trajectory:null,marketComplete:tw.complete});
  const bet=Boolean(validated&&gate&&ev!=null&&edge!=null&&ev>=.035&&edge>=.025&&confidence>=60);
  return {
    modelId:"NHL-WAGER-PROP-v1",version:"research-v1.0-price-aware",
    market:row.marketCanonical||row.market,side,projection:finite(row.fbisProjection),line:finite(row.line),
    americanPrice:price,modelProbability:round(p),calibratedProbability:round(calibrated),
    breakEvenProbability:round(americanToImplied(price)),marketNoVigProbability:round(noVig),
    probabilityEdge:round(edge),expectedValue:round(ev),expectedRoi:round(ev),reliability,
    confidence,confidenceVersion:NHL_WAGER_CONFIDENCE_VERSION,confidenceStatus:"PROVISIONAL_UNCALIBRATED",
    decision:bet?"BET":"PASS",decisionStatus:"RESEARCH_ONLY",suggestedUnits:0,
    canQualify:false,canAuthorizeWager:false,
    reason:bet?"Validated prop model clears provisional price-aware EV gate; stake blocked pending prospective calibration.":"Price/model/availability/confidence gate not cleared."
  };
}

export function summarizeNhlConfidenceMonotonicity(rows=[]){
  const bins=[[0,49],[50,59],[60,69],[70,79],[80,89],[90,100]];
  return bins.map(([lo,hi])=>{
    const xs=rows.filter(r=>finite(r.confidence)!=null&&r.confidence>=lo&&r.confidence<=hi&&finite(r.profitUnits)!=null);
    const units=xs.reduce((s,r)=>s+Number(r.profitUnits),0),risk=xs.reduce((s,r)=>s+Math.abs(finite(r.riskUnits)??1),0);
    return {band:`${lo}-${hi}`,n:xs.length,units:round(units),roi:risk?round(units/risk):null};
  });
}
