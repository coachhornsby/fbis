import test from "node:test";
import assert from "node:assert/strict";
import { promoteNflResearchToBoard } from "../functions/lib/researchBoardPromote.js";
import { NFL_PRO_ID } from "../functions/lib/nflProModel.js";

test("NFL-PRO-v1 becomes research-board primary when its projection is available", () => {
  const game = {
    sport: "nfl",
    home: { abbr: "HOU" },
    away: { abbr: "DAL" },
    nflProShadow: {
      ok: true,
      modelId: NFL_PRO_ID,
      version: "v1",
      home: 27.4,
      away: 21.2,
      margin: 6.2,
      total: 48.6,
      independent: true,
      marketInformed: false,
      canQualify: false,
    },
    nflShadow: { ok: true, home: 24, away: 23, version: "v0.1-margin-calibrated" },
  };
  const out = promoteNflResearchToBoard([game]);
  assert.equal(out.meta.proPrimary, 1);
  assert.equal(out.meta.formFallback, 0);
  assert.equal(out.games[0].projectionEngine, NFL_PRO_ID);
  assert.equal(out.games[0].researchProjection.modelId, NFL_PRO_ID);
  assert.equal(out.games[0].projHomeScore, 27.4);
  assert.equal(out.games[0].projAwayScore, 21.2);
  assert.equal(out.games[0].canQualify, false);
  assert.equal(out.games[0].canAuthorizeWager, false);
});

test("NFL board falls back to calibrated form when NFL-PRO-v1 is unavailable", () => {
  const game = {
    sport: "nfl",
    nflProShadow: { ok: false, reason: "core-epa-or-qb-features-missing" },
    nflShadow: { ok: true, home: 24.5, away: 21.5, version: "v0.1-margin-calibrated" },
  };
  const out = promoteNflResearchToBoard([game]);
  assert.equal(out.meta.proPrimary, 0);
  assert.equal(out.meta.formFallback, 1);
  assert.equal(out.games[0].projHomeScore, 24.5);
  assert.equal(out.games[0].projAwayScore, 21.5);
  assert.equal(out.games[0].canQualify, false);
});
