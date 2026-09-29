import test from "node:test";
import assert from "node:assert/strict";
import { projectNflFormV0, NFL_SHADOW_ID, NFL_CONSTANTS } from "../functions/lib/nflModel.js";

test("NFL shadow baseline is independent and never qualification eligible", () => {
  const game = { neutralSite: false };
  const projection = projectNflFormV0(game, {
    homePrior: { games: 17, pointsFor: 425, pointsAgainst: 340 },
    awayPrior: { games: 17, pointsFor: 340, pointsAgainst: 408 },
    homeCurrent: { games: 2, pointsFor: 54, pointsAgainst: 37 },
    awayCurrent: { games: 2, pointsFor: 38, pointsAgainst: 49 },
  });
  assert.equal(projection.ok, true);
  assert.equal(projection.modelId, NFL_SHADOW_ID);
  assert.equal(projection.independent, true);
  assert.equal(projection.marketInformed, false);
  assert.equal(projection.canQualify, false);
  assert.ok(Number.isFinite(projection.home));
  assert.ok(Number.isFinite(projection.away));
  assert.equal(projection.total, Math.round((projection.home + projection.away) * 10) / 10);
});

test("NFL shadow fails closed without team-specific evidence", () => {
  const projection = projectNflFormV0({}, { homePrior: null, awayPrior: null });
  assert.equal(projection.ok, false);
  assert.equal(projection.canQualify, false);
});


test("NFL form v0.1 shrinks margin by 50% while preserving projected total", () => {
  const projection = projectNflFormV0({ neutralSite: false }, {
    homePrior: { games: 17, pointsFor: 510, pointsAgainst: 306 },
    awayPrior: { games: 17, pointsFor: 306, pointsAgainst: 459 },
    homeCurrent: { games: 3, pointsFor: 90, pointsAgainst: 54 },
    awayCurrent: { games: 3, pointsFor: 51, pointsAgainst: 81 },
  });
  assert.equal(projection.ok, true);
  assert.equal(projection.version, "v0.1-margin-calibrated");
  assert.equal(NFL_CONSTANTS.marginCalibration.slope, 0.5);
  const rawMargin = projection.provenance.rawMargin;
  assert.ok(Number.isFinite(rawMargin));
  assert.ok(Math.abs(projection.margin - rawMargin * 0.5) <= 0.1);
  assert.equal(projection.total, Math.round((projection.home + projection.away) * 10) / 10);
  assert.equal(projection.provenance.marginCalibration.holdoutRawMae, 9.07);
  assert.equal(projection.provenance.marginCalibration.holdoutCalibratedMae, 7.76);
});
