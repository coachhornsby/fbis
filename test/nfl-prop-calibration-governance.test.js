import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("portable calibration mirror matches canonical locked JSON",async()=>{
 const {default:calibration}=await import("../functions/lib/nflPropCalibrationArtifact.js");
 const canonical=JSON.parse(fs.readFileSync(new URL("../data/models/nfl-prop-market-calibration-v2.json",import.meta.url),"utf8"));
 assert.deepEqual(calibration,canonical);
});

import { nflCanonicalGameKey, nflPropTemporalEligibility } from "../functions/api/prizepicks-props.js";
import {
  selectivePropStars,
  propCalibrationValidated,
  nflPropMarketCalibrationState,
} from "../functions/lib/selectivePropEdge.js";

test("NFL raw z distance cannot create 4 or 5 stars while market calibration is unvalidated",()=>{
  const row={
    sport:"nfl",market:"completions",targetRole:"QB1",
    fbisProjection:30,line:20,fbisSigma:2,
    roleConfidence:.95,dataQuality:1,
    propGate:"CLEAR",eligibleForCard:true,
    featureEvidence:{targetRole:true,recent5:true,positionDefense:true,snapShare:true,nextGen:true,opponentMatchup:true},
    propCalibrationValidated:true,
    calibratedHitProbability:.90,
  };
  assert.equal(nflPropMarketCalibrationState(row).validated,false);
  assert.equal(propCalibrationValidated(row),false);
  assert.ok(selectivePropStars(row)<=3);
});

test("all six requested NFL prop markets are currently fail-closed for premium stars",()=>{
  for(const market of ["passing_yards","passing_attempts","completions","receiving_yards","receptions","rushing_yards"]){
    const state=nflPropMarketCalibrationState({sport:"nfl",market});
    assert.equal(state.validated,false,market);
    assert.equal(state.maxStars,3,market);
  }
});

test("NFL champion no longer receives generic availability weighting in slate engine",()=>{
  const src=fs.readFileSync(new URL("../functions/lib/slateEngine.js",import.meta.url),"utf8");
  assert.match(src,/id === "cfb"/);
  assert.doesNotMatch(src,/\["nfl","cfb"\]\.includes\(id\)/);
  assert.match(src,/QB-personnel overlay.*SHADOW-only/s);
});

test("NFL prop state exact event key normalizes equivalent timestamps without heuristic matching",()=>{
  assert.equal(
    nflCanonicalGameKey({start:"2026-10-08T20:15:00.000-04:00",home:"DAL",away:"TB"}),
    nflCanonicalGameKey({start:"2026-10-09T00:15:00Z",home:"dal",away:"tb"})
  );
  assert.notEqual(
    nflCanonicalGameKey({start:"2026-10-09T00:15:00Z",home:"DAL",away:"TB"}),
    nflCanonicalGameKey({start:"2026-10-09T00:15:00Z",home:"TB",away:"DAL"})
  );
});

test("missing and malformed provider quote time never create prospective NFL evidence",()=>{
 const missing=nflPropTemporalEligibility({eventId:"e",frozenAt:"2026-10-12T06:00:00Z",lineObservedAt:null});
 assert.equal(missing.eligible,false);
 assert.ok(missing.reasons.includes("line_source_timestamp_missing"));
 const malformed=nflPropTemporalEligibility({eventId:"e",frozenAt:"2026-10-12T06:00:00Z",lineObservedAt:"wrong"});
 assert.equal(malformed.eligible,false);
 assert.ok(malformed.reasons.includes("line_observed_timestamp_invalid"));
});

test("NFL prop state evidence fails closed for missing event or post-freeze state",()=>{
  const good=nflPropTemporalEligibility({
    eventId:"401872980",frozenAt:"2026-10-07T15:00:10Z",
    lineObservedAt:"2026-10-07T14:00:00Z",stateSourceUpdatedAt:"2026-10-07T15:00:08Z",
    playerProfileUpdatedAt:"2026-10-07T15:00:09Z",
  });
  assert.deepEqual(good,{eligible:true,reasons:[]});

  const bad=nflPropTemporalEligibility({
    eventId:null,frozenAt:"2026-10-07T15:00:10Z",
    lineObservedAt:"2026-10-07T14:00:00Z",stateSourceUpdatedAt:"2026-10-07T15:00:11Z",
    playerProfileUpdatedAt:"2026-10-07T15:00:12Z",
  });
  assert.equal(bad.eligible,false);
  assert.deepEqual(bad.reasons,[
    "canonical_event_missing","state_source_after_freeze","player_profile_after_freeze"
  ]);
});

test('rating explanations identify payout, model hold and historical caps without promoting stars',async()=>{
 const {selectivePropRating,selectivePropStars}=await import('../functions/lib/selectivePropEdge.js');
 const base={sport:'nfl',market:'passing_yards',targetRole:'QB1',fbisProjection:280,line:250,fbisSigma:80,roleConfidence:1,featureEvidence:{targetRole:true,targetRoleName:'QB1',recent5:true,snapShare:true,positionDefense:true,nextGen:true,opponentMatchup:true}};
 const rated=selectivePropRating(base);assert.equal(rated.stars,2);assert.equal(rated.baseStars,2);assert.equal(rated.calibrationValidated,false);assert.ok(rated.limits.some(l=>l.code==='probability_calibration_unvalidated'));
 const alt=selectivePropRating({...base,fbisProjection:500,odds_tier:'goblin'});assert.ok(alt.stars<=2);assert.ok(alt.limits.some(l=>l.code==='ALTERNATE_TIER_PAYOUT_UNPRICED'));
 const hold=selectivePropRating({...base,propGate:'HOLD'});assert.equal(hold.stars,1);assert.match(hold.summary,/hold/);
 for(const row of [base,{...base,odds_tier:'demon'},{...base,propGate:'HOLD'}])assert.equal(selectivePropRating(row).stars,selectivePropStars(row));
});
