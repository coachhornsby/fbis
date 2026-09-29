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
import { NHL_FBIS_V1_ARTIFACT } from "../data/models/nhl-fbis-v1.js";

describe("NHL-FBIS-v1 five-layer research model", () => {
  const artifact = {
    trained: true,
    goaliePriorWeights: {"20232024":0.15,"20242025":0.25,"20252026":0.60},
    goaliePriorPolicy: "season-specific GSAx/game, workload-shrunk within season, then 60/25/15 recency blend",
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
      g1: {
        regressedImpactGoalsPerGame: 0.15,
        history: {
          "20232024": { games:40, gsax:2, gsaxPerGame:0.05, workloadShrink:0.7692, regressedImpactGoalsPerGame:0.0385, priorWeight:0.15 },
          "20242025": { games:45, gsax:4.5, gsaxPerGame:0.10, workloadShrink:0.7895, regressedImpactGoalsPerGame:0.0789, priorWeight:0.25 },
          "20252026": { games:52, gsax:10.4, gsaxPerGame:0.20, workloadShrink:0.8125, regressedImpactGoalsPerGame:0.1625, priorWeight:0.60 }
        }
      },
      g2: {
        regressedImpactGoalsPerGame: 0.08,
        history: {
          "20252026": { games:48, gsax:4.8, gsaxPerGame:0.10, workloadShrink:0.80, regressedImpactGoalsPerGame:0.08, priorWeight:0.60 }
        }
      },
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

  it("ships the fitted three-season historical artifact", () => {
    assert.equal(NHL_FBIS_V1_ARTIFACT.trained, true);
    assert.equal(NHL_FBIS_V1_ARTIFACT.artifactVersion, "research-v1.1-historical-xg-goalie-recency");
    assert.equal(NHL_FBIS_V1_ARTIFACT.gamesParsed, 3936);
    assert.equal(NHL_FBIS_V1_ARTIFACT.failedGames, 0);
    assert.equal(NHL_FBIS_V1_ARTIFACT.goaliePriorWeights?.["20252026"], 0.60);
    assert.equal(NHL_FBIS_V1_ARTIFACT.goaliePriorWeights?.["20242025"], 0.25);
    assert.equal(NHL_FBIS_V1_ARTIFACT.goaliePriorWeights?.["20232024"], 0.15);
    const withLatest = Object.values(NHL_FBIS_V1_ARTIFACT.goalies || {}).find((g) => g?.history?.["20252026"]);
    assert.ok(withLatest, "expected at least one goalie with 2025-26 history");
    assert.equal(withLatest.history["20252026"].priorWeight, 0.60);
    if (withLatest.history["20242025"]) assert.equal(withLatest.history["20242025"].priorWeight, 0.25);
    if (withLatest.history["20232024"]) assert.equal(withLatest.history["20232024"].priorWeight, 0.15);
    assert.ok(NHL_FBIS_V1_ARTIFACT.xg.validationShots > 80000);
    assert.ok(NHL_FBIS_V1_ARTIFACT.xg.validationBrier < 0.07);
    assert.ok(Object.keys(NHL_FBIS_V1_ARTIFACT.goalies || {}).length >= 100);
  });

  it("makes 2025-26 the dominant goalie prior season and exposes the weighting", () => {
    assert.deepEqual(artifact.goaliePriorWeights, {
      "20232024": 0.15,
      "20242025": 0.25,
      "20252026": 0.60,
    });
    const p = projectNhlV1Game(game, ctx);
    assert.equal(p.ok, true);
    assert.equal(p.layers.goalie.home.latestSeason, "20252026");
    assert.equal(p.layers.goalie.away.latestSeason, "20252026");
    assert.equal(p.layers.fiveVFiveXg.goaliePriorWeights["20252026"], 0.60);
    assert.match(p.layers.fiveVFiveXg.goaliePriorPolicy, /60\/25\/15/);
  });

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
