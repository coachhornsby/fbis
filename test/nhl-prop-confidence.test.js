import test from "node:test";
import assert from "node:assert/strict";
import {
  NHL_SAVES_AUDIT_CUTS,
  rateNhlGoalieSavesConfidence,
  rateGenericNhlPropConfidence,
} from "../functions/lib/nhlPropConfidence.js";

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

test("non-saves NHL props are capped below five stars until equivalent subset evidence exists",()=>{
  const r=rateGenericNhlPropConfidence({
    market:"shots_on_goal",projection:4.2,line:2.5,leanProbability:.85,
    validationStatus:"PROMOTE_RESEARCH",lineValidationStatus:"PROMOTE_RESEARCH",eligibleForCard:true,
  });
  assert.equal(r.stars,4);
  assert.equal(r.tier,"PREMIUM");
});
