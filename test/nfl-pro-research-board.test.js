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
      version: "v1.2",
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


test("NFL-PRO-v1.2 tracking signals move projections but remain market-independent", async () => {
  const { projectNflProV1 } = await import("../functions/lib/nflProModel.js");
  const base={
    sport:"nfl",
    home:{abbr:"KC"},away:{abbr:"LV"},
    nflFeatures:{
      home:{offenseEpa:0.10,defenseEpa:-0.05,passEpa:0.15,passEpaAllowed:-0.02,rushEpa:0.03,rushEpaAllowed:0.01,qbEpa:0.16,qbCpoe:3,qbSackRate:0.05},
      away:{offenseEpa:-0.02,defenseEpa:0.05,passEpa:-0.01,passEpaAllowed:0.08,rushEpa:-0.02,rushEpaAllowed:0.04,qbEpa:0.02,qbCpoe:0,qbSackRate:0.08}
    }
  };
  const plain=projectNflProV1(base);
  const tracked=projectNflProV1({
    ...base,
    nflFeatures:{
      home:{...base.nflFeatures.home,qbNgsCpoe:5,qbTimeToThrow:2.55,qbAggressiveness:10,rushYoePerAtt:0.8,rushEfficiency:3.0,receivingSeparation:3.5,receivingYacOe:1.2},
      away:{...base.nflFeatures.away,qbNgsCpoe:-1,qbTimeToThrow:2.95,qbAggressiveness:19,rushYoePerAtt:-0.3,rushEfficiency:4.2,receivingSeparation:2.5,receivingYacOe:-0.6}
    }
  });
  assert.equal(tracked.modelId,NFL_PRO_ID);
  assert.equal(tracked.marketInformed,false);
  assert.equal(tracked.version,"v1.2");
  assert.ok(tracked.margin > plain.margin);
  assert.equal(tracked.coverage.available.includes("nextGenTracking"),true);
});
