export const NHL_SAVES_CONFIDENCE_VERSION = "nhl-saves-stars-v1";

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}

export function classifyNhlSavesEnvironment({
  opponentShotsFor,
  teamShotsAgainst,
  projectedShotsFaced,
  cuts={},
}={}){
  const opp=finite(opponentShotsFor),def=finite(teamShotsAgainst),faced=finite(projectedShotsFaced);
  const oc=cuts?.opponentShotsFor||{},dc=cuts?.teamShotsAgainst||{},fc=cuts?.projectedShotsFaced||{};
  const weakOffense=opp!=null&&finite(oc.q25)!=null&&opp<=Number(oc.q25);
  const strongOffense=opp!=null&&finite(oc.q75)!=null&&opp>=Number(oc.q75);
  const strongDefense=def!=null&&finite(dc.q25)!=null&&def<=Number(dc.q25);
  const weakDefense=def!=null&&finite(dc.q75)!=null&&def>=Number(dc.q75);
  const lowShotsFaced=faced!=null&&finite(fc.q25)!=null&&faced<=Number(fc.q25);
  const highShotsFaced=faced!=null&&finite(fc.q75)!=null&&faced>=Number(fc.q75);
  return {weakOffense,strongOffense,strongDefense,weakDefense,lowShotsFaced,highShotsFaced};
}

/**
 * Evidence-derived NHL goalie saves confidence stars.
 *
 * Stars express historical research confidence, not wager authorization.
 * 5-star is deliberately difficult to earn.
 */
export function rateNhlGoalieSavesConfidence({
  projection,
  line,
  opponentShotsFor,
  teamShotsAgainst,
  projectedShotsFaced,
  starterConfirmed=true,
  lineValidated=true,
  modelValidated=true,
  cuts={},
}={}){
  const p=finite(projection),l=finite(line);
  if(p==null||l==null){
    return {stars:1,label:"1 STAR",side:null,gap:null,tier:"NO_LINE",researchCandidate:false,reasons:["missing_projection_or_line"]};
  }
  const side=p<l?"UNDER":p>l?"OVER":"PUSH";
  const gap=Math.abs(p-l);
  const env=classifyNhlSavesEnvironment({opponentShotsFor,teamShotsAgainst,projectedShotsFaced,cuts});
  const reasons=[];

  if(!starterConfirmed) reasons.push("starter_unconfirmed");
  if(!modelValidated) reasons.push("model_market_not_validated");
  if(!lineValidated) reasons.push("line_not_validated");
  if(side==="PUSH") reasons.push("projection_equals_line");

  if(!starterConfirmed||!modelValidated||!lineValidated||side==="PUSH"){
    return {stars:1,label:"1 STAR",side,gap,tier:"HOLD",researchCandidate:false,reasons,environment:env};
  }

  let stars=1;
  if(side==="UNDER"){
    if(gap>=4) stars=4;
    else if(gap>=3) stars=4;
    else if(gap>=2) stars=3;
    else if(gap>=1) stars=2;

    const supportive=[env.weakOffense,env.strongDefense,env.lowShotsFaced].filter(Boolean).length;
    if(gap>=2&&supportive>=2) stars=Math.min(5,stars+1);
    if(gap>=3&&supportive>=2) stars=5;

    reasons.push("under_signal");
    if(gap>=2) reasons.push("validated_under_gap_2plus");
    if(gap>=3) reasons.push("validated_under_gap_3plus");
    if(env.weakOffense) reasons.push("weak_opponent_shot_generation");
    if(env.strongDefense) reasons.push("strong_team_shot_suppression");
    if(env.lowShotsFaced) reasons.push("low_projected_shots_faced");
  } else {
    // Overs historically need materially larger separation.
    if(gap>=4) stars=4;
    else if(gap>=3) stars=3;
    else if(gap>=2) stars=2;

    const supportive=[env.strongOffense,env.weakDefense,env.highShotsFaced].filter(Boolean).length;
    if(gap>=4&&supportive>=2) stars=5;
    reasons.push("over_signal");
    if(gap>=3) reasons.push("over_requires_large_gap");
    if(env.strongOffense) reasons.push("strong_opponent_shot_generation");
    if(env.weakDefense) reasons.push("weak_team_shot_suppression");
    if(env.highShotsFaced) reasons.push("high_projected_shots_faced");
  }

  stars=clamp(Math.round(stars),1,5);
  const tier=stars===5?"ELITE":stars===4?"PREMIUM":stars===3?"STRONG":stars===2?"LEAN":"WATCH";
  return {
    stars,
    label:`${stars} STAR`,
    side,
    gap,
    tier,
    researchCandidate:stars>=3,
    reasons,
    environment:env,
    confidenceVersion:NHL_SAVES_CONFIDENCE_VERSION,
    historicalBasis:"5245 PIT goalie starts; saves gap/direction + shot-environment subset audit",
  };
}

export function rateGenericNhlPropConfidence({
  market,
  projection,
  line,
  leanProbability,
  validationStatus,
  lineValidationStatus,
  eligibleForCard,
}={}){
  if(String(market)==="saves") return null;
  const p=finite(projection),l=finite(line),prob=finite(leanProbability);
  if(p==null||l==null||eligibleForCard===false||validationStatus!=="PROMOTE_RESEARCH"){
    return {stars:1,label:"1 STAR",tier:"HOLD",researchCandidate:false,reasons:["unvalidated_or_ineligible"]};
  }
  if(lineValidationStatus&&lineValidationStatus!=="PROMOTE_RESEARCH"){
    return {stars:1,label:"1 STAR",tier:"HOLD",researchCandidate:false,reasons:["line_not_validated"]};
  }
  const sigmaEdge=prob==null?0:Math.abs(prob-.5);
  let stars=sigmaEdge>=.25?4:sigmaEdge>=.18?3:sigmaEdge>=.12?2:1;
  // Non-saves markets have not yet earned a 5-star tier.
  stars=Math.min(4,stars);
  return {
    stars,label:`${stars} STAR`,tier:stars===4?"PREMIUM":stars===3?"STRONG":stars===2?"LEAN":"WATCH",
    researchCandidate:stars>=3,reasons:["validated_market_probability_strength"],
    confidenceVersion:"nhl-generic-props-stars-v1"
  };
}
