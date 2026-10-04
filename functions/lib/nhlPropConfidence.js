export const NHL_SAVES_CONFIDENCE_VERSION = "nhl-saves-stars-v1";
export const NHL_SAVES_AUDIT_CUTS = Object.freeze({
  opponentShotsFor:{q25:27.4756097561,q50:28.8234610918,q75:30.0243902439},
  teamShotsAgainst:{q25:27.4637957317,q50:28.8427889714,q75:29.8023976850},
  projectedShotsFaced:{q25:27.8577235772,q50:28.7516046213,q75:29.7160846841},
  priorStarts:{q25:30,q50:48,q75:71},
});

export const NHL_SOG_CONFIDENCE_VERSION = "nhl-sog-stars-v1";
export const NHL_SOG_AUDIT_CUTS = Object.freeze({
  teamShotsFor:{q25:27.4697662602,q50:28.8226164080,q75:30.0243902439},
  opponentShotsAgainst:{q25:27.4637957317,q50:28.8427889714,q75:29.8021341463},
  projectedTeamShots:{q25:27.8574715280,q50:28.7505651398,q75:29.7160846841},
  playerShotRate:{q25:1.0776678277,q50:1.4482130450,q75:2.0152628749},
  playerShotShare:{q25:0.0377306136,q50:0.0505685103,q75:0.0694923814},
  priorGames:{q25:59,q50:81,q75:140},
});

export const NHL_PROP_CONFIDENCE_LINE_RANGE = Object.freeze({
  shots_on_goal:Object.freeze({min:0.5,max:6.5,step:1}),
  saves:Object.freeze({min:15.5,max:39.5,step:1}),
});

export function nhlPropConfidenceLineValidated(market,line){
  const cfg=NHL_PROP_CONFIDENCE_LINE_RANGE[String(market||"")];
  const x=finite(line);
  if(!cfg||x==null)return false;
  if(x<cfg.min-1e-9||x>cfg.max+1e-9)return false;
  const k=(x-cfg.min)/cfg.step;
  return Math.abs(k-Math.round(k))<1e-9;
}

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}

export function classifyNhlSavesEnvironment({
  opponentShotsFor,
  teamShotsAgainst,
  projectedShotsFaced,
  cuts=NHL_SAVES_AUDIT_CUTS,
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
  cuts=NHL_SAVES_AUDIT_CUTS,
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

export function classifyNhlSogEnvironment({
  teamShotsFor,
  opponentShotsAgainst,
  projectedTeamShots,
  playerShotRate,
  playerShotShare,
  cuts=NHL_SOG_AUDIT_CUTS,
}={}){
  const team=finite(teamShotsFor),opp=finite(opponentShotsAgainst),proj=finite(projectedTeamShots),rate=finite(playerShotRate),share=finite(playerShotShare);
  const tc=cuts?.teamShotsFor||{},oc=cuts?.opponentShotsAgainst||{},pc=cuts?.projectedTeamShots||{},rc=cuts?.playerShotRate||{},sc=cuts?.playerShotShare||{};
  return {
    highTeamVolume:team!=null&&finite(tc.q75)!=null&&team>=Number(tc.q75),
    lowTeamVolume:team!=null&&finite(tc.q25)!=null&&team<=Number(tc.q25),
    favorableOpponent:opp!=null&&finite(oc.q75)!=null&&opp>=Number(oc.q75),
    toughOpponent:opp!=null&&finite(oc.q25)!=null&&opp<=Number(oc.q25),
    highProjectedTeamShots:proj!=null&&finite(pc.q75)!=null&&proj>=Number(pc.q75),
    lowProjectedTeamShots:proj!=null&&finite(pc.q25)!=null&&proj<=Number(pc.q25),
    highVolumeShooter:rate!=null&&finite(rc.q75)!=null&&rate>=Number(rc.q75),
    lowVolumeShooter:rate!=null&&finite(rc.q25)!=null&&rate<=Number(rc.q25),
    highShotShare:share!=null&&finite(sc.q75)!=null&&share>=Number(sc.q75),
    lowShotShare:share!=null&&finite(sc.q25)!=null&&share<=Number(sc.q25),
  };
}

export function rateNhlShotsOnGoalConfidence({
  projection,
  line,
  teamShotsFor,
  opponentShotsAgainst,
  projectedTeamShots,
  playerShotRate,
  playerShotShare,
  lineValidated=true,
  modelValidated=true,
  cuts=NHL_SOG_AUDIT_CUTS,
}={}){
  const p=finite(projection),l=finite(line);
  if(p==null||l==null){
    return {stars:1,label:"1 STAR",side:null,gap:null,tier:"NO_LINE",researchCandidate:false,reasons:["missing_projection_or_line"]};
  }
  const side=p<l?"UNDER":p>l?"OVER":"PUSH",gap=Math.abs(p-l);
  const env=classifyNhlSogEnvironment({teamShotsFor,opponentShotsAgainst,projectedTeamShots,playerShotRate,playerShotShare,cuts});
  const reasons=[];
  if(!modelValidated) reasons.push("model_market_not_validated");
  if(!lineValidated) reasons.push("line_not_validated");
  if(side==="PUSH") reasons.push("projection_equals_line");
  if(!modelValidated||!lineValidated||side==="PUSH"){
    return {stars:1,label:"1 STAR",side,gap,tier:"HOLD",researchCandidate:false,reasons,environment:env,confidenceVersion:NHL_SOG_CONFIDENCE_VERSION};
  }

  let stars=gap>=2?5:gap>=1.5?4:gap>=1?3:gap>=0.5?2:1;
  if(side==="OVER"){
    reasons.push("sog_over_signal");
    if(gap>=1) reasons.push("validated_over_gap_1plus");
    if(gap>=2) reasons.push("validated_over_gap_2plus");
    const supportive=[env.highVolumeShooter,env.favorableOpponent,env.highProjectedTeamShots,env.highShotShare].filter(Boolean).length;
    if(gap>=1&&gap<2&&supportive>=3) stars=Math.min(4,stars+1);
    if(env.highVolumeShooter) reasons.push("high_volume_shooter");
    if(env.favorableOpponent) reasons.push("high_opponent_shot_allowance");
    if(env.highProjectedTeamShots) reasons.push("high_projected_team_shots");
    if(env.highShotShare) reasons.push("high_player_shot_share");
  }else{
    reasons.push("sog_under_signal");
    if(gap>=1) reasons.push("validated_under_gap_1plus");
    if(gap>=2) reasons.push("validated_under_gap_2plus");
    const supportive=[env.lowVolumeShooter,env.toughOpponent,env.lowProjectedTeamShots,env.lowShotShare].filter(Boolean).length;
    if(gap>=1&&gap<1.5&&supportive>=3) stars=Math.min(4,stars+1);
    if(gap>=1.5&&gap<2&&supportive>=3) stars=5;
    if(env.lowVolumeShooter) reasons.push("low_volume_shooter");
    if(env.toughOpponent) reasons.push("low_opponent_shot_allowance");
    if(env.lowProjectedTeamShots) reasons.push("low_projected_team_shots");
    if(env.lowShotShare) reasons.push("low_player_shot_share");
  }
  stars=clamp(Math.round(stars),1,5);
  return {
    stars,label:`${stars} STAR`,side,gap,
    tier:stars===5?"ELITE":stars===4?"PREMIUM":stars===3?"STRONG":stars===2?"LEAN":"WATCH",
    researchCandidate:stars>=3,reasons,environment:env,
    confidenceVersion:NHL_SOG_CONFIDENCE_VERSION,
    historicalBasis:"94456 PIT skater-games; SOG gap/direction + shooter/team/opponent shot-environment audit",
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
