import test from "node:test";
import assert from "node:assert/strict";
import { palLineupKFactor, overProbability, projectPitcherK } from "../functions/lib/mlbPitcherKModel.js";

test("Pal lineup factor is bounded and sample gated", () => {
  assert.equal(palLineupKFactor(50, 9), 1.1);
  assert.equal(palLineupKFactor(1000, 9), 1.15);
  assert.equal(palLineupKFactor(-1000, 9), 0.85);
  assert.equal(palLineupKFactor(50, 2), 1);
});

test("pitcher K projection does not ingest Pal final K", () => {
  const p=projectPitcherK({pitcherId:1,pitcherName:"Test",seasonK9:9,seasonIp:150,expectedInnings:6,expectedInningsSource:"ballpark-pal",palKVs:50,palMatchupN:9,lineupsOfficial:true,palProjectedK:99});
  assert.equal(p.projectedKs,6.6);
  assert.equal(p.provenance.palFinalKProjectionUsed,false);
  assert.equal(p.canQualify,false);
  assert.ok(p.thresholds["5.5"] > 0 && p.thresholds["5.5"] < 1);
});

test("half-line Poisson over probability is monotone", () => {
  assert.ok(overProbability(7,5.5) > overProbability(7,7.5));
});
