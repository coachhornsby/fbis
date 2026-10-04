const TIER_FALLBACK=Object.freeze({
  CONVICTION:5,QUALIFIED:4,LEAN:3,WATCH:3,PASS:2,RESEARCH:2,BLOCKED:2,NO_MODEL:1,
});
const CFB_STATE_STARS=Object.freeze({
  COMPLETE:4,PARTIAL:3,PRIOR_ONLY:2,PROVISIONAL:2,LEAGUE_AVERAGE_ONLY:1,UNAVAILABLE:1,NO_MODEL:1,
});
const HARD_DQ_STATES=new Set(["DQ","BLOCKED","INVALID","FAILED","REJECTED","CORRUPT"]);

function num(v){
  if(v==null||v==="") return NaN;
  const n=Number(v);
  return Number.isFinite(n)?n:NaN;
}
function starsFromQuality(q){
  if(!Number.isFinite(q)) return null;
  if(q>=90) return 5;
  if(q>=80) return 4;
  if(q>=68) return 3;
  if(q>=55) return 2;
  return 1;
}
function hasProjection(game={}){
  const sport=String(game?.sport||"").toLowerCase();
  if(sport==="nfl" && game?.nflProShadow?.ok){
    const home=num(game.nflProShadow.home ?? game.nflProShadow.projectedHome);
    const away=num(game.nflProShadow.away ?? game.nflProShadow.projectedAway);
    if(Number.isFinite(home)&&Number.isFinite(away)) return true;
  }
  const home=num(game?.model?.projHome ?? game?.projHome ?? game?.projHomeScore);
  const away=num(game?.model?.projAway ?? game?.projAway ?? game?.projAwayScore);
  return Number.isFinite(home)&&Number.isFinite(away);
}
function qualityScore(game={}){
  const vals=[
    game?.quality?.score,
    game?.dataQuality,
    game?.data_quality,
    game?.model?.dataQuality,
    game?.model?.data_quality,
    game?.cfb?.dataQuality,
    game?.cbb?.dataQuality,
  ];
  for(const v of vals){
    const n=num(v);
    if(Number.isFinite(n)) return n;
  }
  return NaN;
}
function decisionTier(game={}){
  const tag=String(game?.rec?.tag||"").toUpperCase();
  if(game?.rec) return tag==="CONVICTION"?"CONVICTION":"QUALIFIED";
  if(game?.lean) return "LEAN";
  const maturity=String(game?.projectionMaturity||game?.model?.maturity||"").toUpperCase();
  if(maturity==="RESEARCH"||game?.canQualify===false) return "RESEARCH";
  if(game?.qualificationBlocked||game?.projectionUnavailable) return "BLOCKED";
  return hasProjection(game)?"PASS":"NO_MODEL";
}
function hardDq(game={}){
  const raw=game?.dqState ?? game?.quality?.dqState;
  if(raw===true) return true;
  return HARD_DQ_STATES.has(String(raw||"").toUpperCase());
}
function cfbStars(game={}){
  if(String(game?.sport||"").toLowerCase()!=="cfb") return null;
  const state=String(game?.cfb?.projectionState||game?.projectionState||game?.quality?.state||"").toUpperCase();
  return state ? (CFB_STATE_STARS[state]??null) : null;
}
function soccerStars(game={}){
  if(String(game?.sport||"").toLowerCase()!=="soccer") return null;
  const s=num(game?.soccerConfidence?.stars ?? game?.confidencePick?.stars ?? game?.soccerFbis?.confidencePick?.stars ?? game?.model?.confidenceStars);
  return Number.isFinite(s)?Math.max(1,Math.min(5,Math.round(s))):null;
}
function nflStars(game={},q){
  if(String(game?.sport||"").toLowerCase()!=="nfl") return null;
  const pro=game?.nflProShadow||game?.challengers?.["NFL-PRO-v1"];
  const coverage=num(pro?.coverage?.share);
  if(!pro?.ok||!Number.isFinite(coverage)) return null;

  // IMPORTANT: use the current NFL-PRO projection itself, never stale fallback
  // game.model scores. Server-computed confidenceStars is authoritative in the UI,
  // so stale scores here previously collapsed most/all of the slate to one tier.
  const home=num(pro?.home ?? pro?.projectedHome);
  const away=num(pro?.away ?? pro?.projectedAway);
  const margin=Number.isFinite(home)&&Number.isFinite(away)?home-away:NaN;
  const fairHomeSpread=Number.isFinite(margin)?-margin:NaN;
  const total=Number.isFinite(home)&&Number.isFinite(away)?home+away:NaN;

  const marketSpread=num(
    game?.market?.execution?.spread ??
    game?.market?.consensus?.spread ??
    game?.market?.reference?.spread ??
    game?.odds?.spread ??
    game?.odds?.pinSpread
  );
  const marketTotal=num(
    game?.market?.execution?.total ??
    game?.market?.consensus?.total ??
    game?.market?.reference?.total ??
    game?.odds?.total ??
    game?.odds?.pinTotal
  );

  const spreadGap=Math.abs(
    Number.isFinite(fairHomeSpread)&&Number.isFinite(marketSpread)
      ? fairHomeSpread-marketSpread
      : NaN
  );
  const totalGap=Math.abs(
    Number.isFinite(total)&&Number.isFinite(marketTotal)
      ? total-marketTotal
      : NaN
  );

  const quality=Number.isFinite(q)?Math.max(0,Math.min(1,q/100)):0.65;
  const sigmaMargin=num(pro?.sigmaMargin);
  const sigmaTotal=num(pro?.sigmaTotal);
  const uncertaintySignal=Number.isFinite(sigmaMargin)&&Number.isFinite(sigmaTotal)
    ? Math.max(0,Math.min(1,1-(((sigmaMargin-13.8)/7)*0.6+((sigmaTotal-12.8)/7)*0.4)))
    : 0.55;
  const edgeSignal=Math.max(
    Number.isFinite(spreadGap)?Math.min(1,spreadGap/7):0,
    Number.isFinite(totalGap)?Math.min(1,totalGap/10):0
  );

  const availabilityPenalty=
    game?.availabilityImpact?.criticalUnresolved || game?.availabilityImpact?.stale ? 0.12 : 0;

  // Projection-confidence display only. Not wager authorization and not the
  // empirically calibrated NFL-CONFIDENCE-v1 wagering score.
  const score=100*Math.max(0,Math.min(1,
    0.35*Math.max(0,Math.min(1,coverage))+
    0.25*quality+
    0.20*uncertaintySignal+
    0.20*edgeSignal-
    availabilityPenalty
  ));

  if(score>=78) return 5;
  if(score>=60) return 4;
  if(score>=48) return 3;
  if(score>=36) return 2;
  return 1;
}

export function canonicalConfidenceStars(game={}){
  if(!hasProjection(game)) return 1;
  if(hardDq(game)) return 1;
  const q=qualityScore(game);
  let stars=cfbStars(game);
  if(stars==null) stars=soccerStars(game);
  if(stars==null) stars=nflStars(game,q);
  if(stars==null) stars=starsFromQuality(q);
  if(stars==null) stars=TIER_FALLBACK[decisionTier(game)]||2;

  if(String(game?.sport||"").toLowerCase()==="cfb"){
    if(Number.isFinite(q)&&q>=90) stars=Math.max(stars,5);
    else if(Number.isFinite(q)&&q>=80) stars=Math.max(stars,4);
    else if(Number.isFinite(q)&&q>=68) stars=Math.max(stars,3);
  }
  return Math.max(1,Math.min(5,stars));
}
