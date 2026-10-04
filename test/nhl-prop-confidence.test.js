import test from "node:test";
import assert from "node:assert/strict";
import {
  NHL_SAVES_AUDIT_CUTS,
  rateNhlGoalieSavesConfidence,
  rateNhlShotsOnGoalConfidence,
  rateGenericNhlPropConfidence,
} from "../functions/lib/nhlPropConfidence.js";
import { withFbisPropAnalytics } from "../src/features/playerProps/buildPlayerPropsBoard.js";

test("goalie saves confidence is asymmetric: unders earn stars sooner than overs",()=>{
  const under=rateNhlGoalieSavesConfidence({
    projection:24.0,line:27.0,
    opponentShotsFor:27.0,teamShotsAgainst:27.0,projectedShotsFaced:27.0,
    starterConfirmed:true,lineValidated:true,modelValidated:true,
  });
  const over=rateNhlGoalieSavesConfidence({
    projection:30.0,line:27.0,
    opponentShotsFor:31.0,teamShotsAgainst:31.0,projectedShotsFaced:31.0,
    starterConfirmed:true,lineValidated:true,modelValidated:true,
  });
  assert.ok(under.stars>=4);
  assert.equal(over.stars,3);
  assert.equal(under.side,"UNDER");
  assert.equal(over.side,"OVER");
});

test("weak offense plus strong defense can elevate a validated saves under to five stars",()=>{
  const r=rateNhlGoalieSavesConfidence({
    projection:23.0,line:26.5,
    opponentShotsFor:NHL_SAVES_AUDIT_CUTS.opponentShotsFor.q25-1,
    teamShotsAgainst:NHL_SAVES_AUDIT_CUTS.teamShotsAgainst.q25-1,
    projectedShotsFaced:NHL_SAVES_AUDIT_CUTS.projectedShotsFaced.q25-1,
    starterConfirmed:true,lineValidated:true,modelValidated:true,
  });
  assert.equal(r.stars,5);
  assert.equal(r.tier,"ELITE");
  assert.equal(r.researchCandidate,true);
  assert.ok(r.reasons.includes("weak_opponent_shot_generation"));
  assert.ok(r.reasons.includes("strong_team_shot_suppression"));
});

test("unconfirmed goalie or unvalidated line is always one star",()=>{
  for(const args of [
    {starterConfirmed:false,lineValidated:true,modelValidated:true},
    {starterConfirmed:true,lineValidated:false,modelValidated:true},
    {starterConfirmed:true,lineValidated:true,modelValidated:false},
  ]){
    const r=rateNhlGoalieSavesConfidence({projection:20,line:30,opponentShotsFor:26,teamShotsAgainst:26,projectedShotsFaced:26,...args});
    assert.equal(r.stars,1);
    assert.equal(r.researchCandidate,false);
  }
});

test("NHL props without dedicated subset evidence remain capped below five stars",()=>{
  const r=rateGenericNhlPropConfidence({
    market:"goals",projection:1.2,line:0.5,leanProbability:.85,
    validationStatus:"PROMOTE_RESEARCH",lineValidationStatus:"PROMOTE_RESEARCH",eligibleForCard:true,
  });
  assert.equal(r.stars,4);
  assert.equal(r.tier,"PREMIUM");
});

test("player props board exposes the same NHL saves star grade",()=>{
  const row=withFbisPropAnalytics({
    sport:"nhl",market:"saves",marketCanonical:"saves",
    fbisProjection:23.0,fbisSigma:5.5,line:26.5,
    validationStatus:"PROMOTE_RESEARCH",lineValidationStatus:"PROMOTE_RESEARCH",
    propGate:"CLEAR",eligibleForCard:true,
    shotEnvironment:{opponentShotsFor:26.5,teamShotsAgainst:26.5,projectedShotsFaced:26.5},
  });
  assert.equal(row.confidenceStars,5);
  assert.equal(row.confidenceSide,"UNDER");
  assert.equal(row.confidenceTier,"ELITE");
  assert.equal(row.confidenceResearchCandidate,true);
});

test("SOG stars rise with projection-to-line separation",()=>{
  const common={teamShotsFor:29,opponentShotsAgainst:29,projectedTeamShots:29,playerShotRate:2,playerShotShare:.07,lineValidated:true,modelValidated:true};
  const one=rateNhlShotsOnGoalConfidence({projection:2.7,line:2.5,...common});
  const two=rateNhlShotsOnGoalConfidence({projection:3.2,line:2.5,...common});
  const three=rateNhlShotsOnGoalConfidence({projection:3.7,line:2.5,...common});
  const four=rateNhlShotsOnGoalConfidence({projection:4.2,line:2.5,...common});
  const five=rateNhlShotsOnGoalConfidence({projection:4.7,line:2.5,...common});
  assert.equal(one.stars,1);
  assert.equal(two.stars,2);
  assert.ok(three.stars>=3);
  assert.ok(four.stars>=4);
  assert.equal(five.stars,5);
});

test("favorable SOG environment can elevate strong but sub-2-shot signals without fabricating five stars",()=>{
  const over=rateNhlShotsOnGoalConfidence({
    projection:4.1,line:2.5,
    teamShotsFor:31,opponentShotsAgainst:31,projectedTeamShots:31,
    playerShotRate:3.0,playerShotShare:.09,
    lineValidated:true,modelValidated:true,
  });
  assert.equal(over.side,"OVER");
  assert.equal(over.stars,4);
  assert.ok(over.reasons.includes("high_volume_shooter"));

  const under=rateNhlShotsOnGoalConfidence({
    projection:1.0,line:2.5,
    teamShotsFor:26,opponentShotsAgainst:26,projectedTeamShots:26,
    playerShotRate:.8,playerShotShare:.025,
    lineValidated:true,modelValidated:true,
  });
  assert.equal(under.side,"UNDER");
  assert.equal(under.stars,5);
  assert.ok(under.reasons.includes("low_volume_shooter"));
});

test("unvalidated SOG line or model is held at one star",()=>{
  for(const args of [
    {lineValidated:false,modelValidated:true},
    {lineValidated:true,modelValidated:false},
  ]){
    const r=rateNhlShotsOnGoalConfidence({projection:4.5,line:2.5,teamShotsFor:31,opponentShotsAgainst:31,projectedTeamShots:31,playerShotRate:3,playerShotShare:.09,...args});
    assert.equal(r.stars,1);
    assert.equal(r.researchCandidate,false);
  }
});

test("player props board exposes SOG-specific star grade and direction",()=>{
  const row=withFbisPropAnalytics({
    sport:"nhl",market:"shots_on_goal",marketCanonical:"shots_on_goal",
    fbisProjection:4.6,fbisSigma:1.4,line:2.5,
    validationStatus:"PROMOTE_RESEARCH",lineValidationStatus:"PROMOTE_RESEARCH",
    propGate:"CLEAR",eligibleForCard:true,
    shotEnvironment:{
      teamShotsFor:31,opponentShotsAgainst:31,projectedTeamShots:31,
      playerShotRate:3.1,playerShotShare:.09,
    },
  });
  assert.equal(row.confidenceStars,5);
  assert.equal(row.confidenceSide,"OVER");
  assert.equal(row.confidenceTier,"ELITE");
  assert.equal(row.confidenceVersion,"nhl-sog-stars-v1");
});


test("historically tested NHL saves line can show confidence even when wager line is HOLD",()=>{
  const row=withFbisPropAnalytics({
    sport:"nhl",market:"saves",marketCanonical:"saves",
    fbisProjection:24.5,fbisSigma:5.5,line:21.5,
    validationStatus:"PROMOTE_RESEARCH",lineValidationStatus:"HOLD_RESEARCH",
    propGate:"CLEAR",eligibleForCard:false,
    shotEnvironment:{opponentShotsFor:30.5,teamShotsAgainst:30.5,projectedShotsFaced:30.5},
  });
  assert.ok(row.confidenceStars>=2);
  assert.notEqual(row.confidenceLabel,"1 STAR");
  assert.equal(row.lineValidationStatus,"HOLD_RESEARCH");
});

test("untested NHL confidence line remains one star without granting false reliability",()=>{
  const row=withFbisPropAnalytics({
    sport:"nhl",market:"saves",marketCanonical:"saves",
    fbisProjection:24.5,fbisSigma:5.5,line:40.5,
    validationStatus:"PROMOTE_RESEARCH",lineValidationStatus:"PROMOTE_RESEARCH",
    propGate:"CLEAR",eligibleForCard:true,
    shotEnvironment:{opponentShotsFor:30.5,teamShotsAgainst:30.5,projectedShotsFaced:30.5},
  });
  assert.equal(row.confidenceStars,1);
  assert.ok(row.confidenceReasons.includes("line_not_validated"));
});
