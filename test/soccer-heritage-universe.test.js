import test from "node:test";
import assert from "node:assert/strict";
import { HERITAGE_SOCCER_EXTENDED_OFFERINGS, heritageSoccerOfferingTier, heritageSoccerAllOfferings } from "../functions/lib/soccerCompetitionRegistry.js";

test("extended Heritage soccer universe is registered",()=>{
  assert.equal(HERITAGE_SOCCER_EXTENDED_OFFERINGS.length,145);
  assert.ok(heritageSoccerAllOfferings().includes("Japan J1 League"));
  assert.ok(heritageSoccerAllOfferings().includes("England League One"));
  assert.ok(heritageSoccerAllOfferings().includes("Venezuela Primera Division"));
});

test("development and reserve competitions are blocked pending separate model",()=>{
  assert.equal(heritageSoccerOfferingTier("Argentina Primera B Metropolitana Reserves").modelEligible,false);
  assert.equal(heritageSoccerOfferingTier("Portugal Liga Next Gen U23").tier,"D");
  assert.equal(heritageSoccerOfferingTier("England Professional Development U21 League").reason,"YOUTH_RESERVE_OR_DEVELOPMENT");
});

test("ordinary senior leagues enter discovery rather than automatic approval",()=>{
  assert.equal(heritageSoccerOfferingTier("Japan J1 League").tier,"DISCOVERY");
  assert.equal(heritageSoccerOfferingTier("Germany 2. Bundesliga").modelEligible,null);
});
