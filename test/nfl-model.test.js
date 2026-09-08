import test from "node:test";
import assert from "node:assert/strict";
import { projectNflFormV0, NFL_SHADOW_ID } from "../functions/lib/nflModel.js";

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
