import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  NHL_FBIS_V1_ID,
  NHL_FBIS_V1_VERSION,
  projectNhlV1Game,
} from "../functions/lib/nhlFbisV1.js";
import { promoteNhlResearchToBoard } from "../functions/lib/researchBoardPromote.js";
import { qualificationIntegrity } from "../functions/lib/slateEngine.js";
import { getModel } from "../functions/lib/canonical/modelRegistry.js";

describe("NHL-FBIS-v1 five-layer research model", () => {
  const artifact = {
    trained: true,
    artifactVersion: "test-fit",
    league: {
      fiveVFiveXgPerTeamGame: 2.35,
      goalsPerTeamGame: 3.05,
      ppOpportunitiesPerTeamGame: 3.0,
      ppPct: 0.21,
    },
    teams: {
      CAR: { xGF5v5PerGame: 2.62, xGA5v5PerGame: 2.15 },
      FLA: { xGF5v5PerGame: 2.51, xGA5v5PerGame: 2.28 },
    },
    goalies: {
      g1: { regressedImpactGoalsPerGame: 0.15 },
      g2: { regressedImpactGoalsPerGame: 0.08 },
    },
    expectedGoalieByTeam: {
      CAR: { goalieId: "g1", games: 52, impactGoalsPerGame: 0.15 },
      FLA: { goalieId: "g2", games: 48, impactGoalsPerGame: 0.08 },
    },
    xg: {
      validationSeason: "20252026",
      validationShots: 10000,
      validationBrier: 0.055,
      validationLogLoss: 0.21,
    },
  };

  const ctx = {
    ok: true,
    artifact,
    teams: {
      CAR: { abbr: "CAR", games: 0, gfpg: 3.45, gapg: 2.72, pp: 0.235, pk: 0.82, currentWeight: 0 },
      FLA: { abbr: "FLA", games: 0, gfpg: 3.22, gapg: 2.80, pp: 0.228, pk: 0.81, currentWeight: 0 },
    },
    priorGoalies: [],
    currentGoalies: [],
    schedule: [],
  };

  const game = {
    id: "nhl-test",
    sport: "nhl",
    start: "2026-09-29T22:00:00Z",
    home: { abbr: "CAR", name: "Carolina Hurricanes" },
    away: { abbr: "FLA", name: "Florida Panthers" },
    odds: { total: 6.0, spread: -1.5 },
  };

  it("combines all five independent layers", () => {
    const p = projectNhlV1Game(game, ctx);
    assert.equal(p.ok, true);
    assert.equal(p.modelId, NHL_FBIS_V1_ID);
    assert.equal(p.modelVersion, NHL_FBIS_V1_VERSION);
    assert.equal(p.marketInformed, false);
    assert.equal(p.canQualify, false);
    assert.ok(Number.isFinite(p.home));
    assert.ok(Number.isFinite(p.away));
    assert.ok(p.layers.fiveVFiveXg);
    assert.ok(p.layers.goalie);
    assert.ok(p.layers.specialTeams);
    assert.ok(p.layers.situational);
    assert.ok(p.probability);
    assert.ok(Number.isFinite(p.probability.homeWinIncludingOt));
  });

  it("promotes five-layer scores to research board but never grants wager authority", () => {
    const p = projectNhlV1Game(game, ctx);
    const promoted = promoteNhlResearchToBoard([{ ...game, nhlV1: p }]).games[0];
    assert.equal(promoted.projectionKind, "FBIS");
    assert.equal(promoted.projectionMaturity, "RESEARCH");
    assert.equal(promoted.canQualify, false);
    assert.equal(promoted.canAuthorizeWager, false);
    assert.equal(qualificationIntegrity("nhl", promoted).ok, false);
  });

  it("registers NHL-FBIS-v1 as independent research", () => {
    const reg = getModel(NHL_FBIS_V1_ID);
    assert.equal(reg?.sport, "nhl");
    assert.equal(reg?.maturity, "RESEARCH");
    assert.equal(reg?.marketInformed, false);
    assert.equal(reg?.independent, true);
    assert.equal(reg?.canQualify, false);
  });

  it("loads official power-play and penalty-kill reports for the special-teams layer", async () => {
    const src = await readFile(new URL("../functions/lib/nhlFbisV1.js", import.meta.url), "utf8");
    assert.match(src, /team\/powerplay/);
    assert.match(src, /team\/penaltykill/);
    assert.match(src, /goalie\/summary/);
    assert.match(src, /schedule\//);
  });

  it("historical fitter uses official NHL schedules and play by play without market inputs", async () => {
    const src = await readFile(new URL("../scripts/nhl-historical-fit.mjs", import.meta.url), "utf8");
    assert.match(src, /api-web\.nhle\.com\/v1/);
    assert.match(src, /gamecenter\/\$\{game\.id\}\/play-by-play/);
    assert.match(src, /situationCode/);
    assert.match(src, /goalieInNetId/);
    assert.doesNotMatch(src, /pinnacle|sportsbook|odds.*price/i);
  });
});
