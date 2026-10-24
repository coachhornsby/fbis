import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCfbProspectiveHybridRows } from "../functions/lib/cfbCoreProspectiveEvidence.js";

const MODEL = "CFB-CORE-MARGIN-HYBRID-v1";
const ARTIFACT = "frozen-leading-2025";
function game(id, overrides = {}) {
  return {
    id: "shadow-"+id,game_id: String(id),core_model_id:MODEL,core_artifact_id:ARTIFACT,
    season:2026,week:8,core_through_week:6,
    eligibility:"eligible_projected",
    generation_at:"2026-10-20T14:00:00.000Z",
    feature_cutoff_at:"2026-10-18T12:00:00.000Z",
    kickoff:"2026-10-24T22:00:00.000Z",
    champion_home:21,champion_away:17,
    core_home:24,core_away:14,
    final_verified:1,actual_home:24,actual_away:14,
    ...overrides,
  };
}

test("prospective gate counts earliest valid pregame freeze once per game", () => {
  const r=evaluateCfbProspectiveHybridRows([
    game(1),game(1,{id:"later",generation_at:"2026-10-20T17:00:00.000Z"}),
    game(2,{generation_at:"2026-10-24T22:10:00.000Z"}), // too late
    game(3,{feature_cutoff_at:"2026-10-25T00:00:00.000Z"}), // feature future
    game(4,{core_home:25,core_away:14}), // changed totals
    game(5,{final_verified:0}),
  ],{artifactId:ARTIFACT});
  assert.equal(r.frozenUniqueGames,2);
  assert.equal(r.prospectiveSettledN,1);
  assert.equal(r.metrics.marginMaeDelta,-6);
  assert.equal(r.metrics.aaTotalMae,r.metrics.hybridTotalMae);
  assert.equal(r.metrics.weekClustered95PctCi,null);
  assert.equal(r.gate.autoPromote,false);
  assert.equal(r.gate.decision,"RETAIN_CHAMPION_RESEARCH_ONLY");
});
test("200 settled independent games still do not auto-promote", () => {
  const records=Array.from({length:200},(_,i)=>game(i+100,{
    week:8+(i%8),core_through_week:6,
    generation_at:"2026-10-20T14:00:00.000Z",
    kickoff:"2026-12-24T22:00:00.000Z",
    id:"shadow-"+(i+100),
  }));
  const r=evaluateCfbProspectiveHybridRows(records,{artifactId:ARTIFACT,bootstrapN:100});
  assert.equal(r.prospectiveSettledN,200);
  assert.equal(r.weekClusters,8);
  assert.ok(r.metrics.weekClustered95PctCi.excludesZero);
  assert.ok(r.gate.fail.includes("operator-approval-required"));
  assert.equal(r.gate.decision,"RETAIN_CHAMPION_RESEARCH_ONLY");
});
