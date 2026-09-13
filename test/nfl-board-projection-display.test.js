import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveBoardProjection,
  fbisProjection,
  hasPureFbisProjection,
  boardShowsFairProbability,
  boardDecision,
} from "../src/lib/boardDecision.js";
import { buildGameWorkspaceView } from "../src/features/game/buildGameWorkspaceView.js";
import { promoteNflResearchToBoard } from "../functions/lib/researchBoardPromote.js";

function nflResearchGame(extra = {}) {
  return {
    id: "dal@nyg",
    sport: "nfl",
    away: { abbr: "DAL", name: "Cowboys" },
    home: { abbr: "NYG", name: "Giants" },
    projectionKind: "FBIS",
    projectionMaturity: "RESEARCH",
    publicationStatus: "RESEARCH_PUBLISHABLE",
    pureProjectionAvailable: true,
    researchProjection: {
      modelId: "NFL-FBIS-PURE",
      modelVersion: "research-v0-form",
      away: 30.3,
      home: 30.7,
      maturity: "RESEARCH",
    },
    model: {
      projAway: 30.3,
      projHome: 30.7,
      projectionKind: "FBIS",
      maturity: "RESEARCH",
      recipe: { engine: "NFL-FBIS-PURE", version: "research-v0-form" },
      pHomeFinal: 0.55,
    },
    projAwayScore: 30.3,
    projHomeScore: 30.7,
    marketProjAway: 21.5,
    marketProjHome: 24.0,
    ...extra,
  };
}

describe("NFL board canonical projection resolver", () => {
  it("compact and expanded share resolveBoardProjection scores", () => {
    const game = nflResearchGame();
    const compact = fbisProjection(game);
    const detail = resolveBoardProjection(game);
    assert.equal(compact.available, true);
    assert.equal(detail.available, true);
    assert.equal(compact.away, detail.away);
    assert.equal(compact.home, detail.home);
    assert.equal(compact.kind, "FBIS");
    assert.equal(detail.displayKind, "FBIS");

    const view = buildGameWorkspaceView({
      ...game,
      projAway: game.projAwayScore,
      projHome: game.projHomeScore,
    });
    assert.equal(view.event.model.projAway, detail.away);
    assert.equal(view.event.model.projHome, detail.home);
    assert.equal(view.event.model.projectionKind, "FBIS");
  });

  it("never shows unavailable when independent research scores exist", () => {
    const game = nflResearchGame({
      // Stale market kind must not hide research scores.
      projectionKind: "PINNACLE_IMPLIED",
      model: {
        projAway: 30.3,
        projHome: 30.7,
        projectionKind: "PINNACLE_IMPLIED",
        maturity: "RESEARCH",
        recipe: { engine: "NFL-FBIS-PURE", version: "research-v0-form" },
        pHomeFinal: 0.55,
      },
    });
    const proj = resolveBoardProjection(game);
    assert.equal(proj.available, true);
    assert.equal(hasPureFbisProjection(game), true);
    assert.equal(fbisProjection(game).available, true);
    assert.notEqual(boardDecision(game).tier, "NO_MODEL");
  });

  it("never headlines PINNACLE_IMPLIED when FBIS research projection exists", () => {
    const game = nflResearchGame({
      projectionKind: "PINNACLE_IMPLIED",
      model: {
        projAway: 30.3,
        projHome: 30.7,
        projectionKind: "PINNACLE_IMPLIED",
        maturity: "RESEARCH",
        marketProjAway: 21.5,
        marketProjHome: 24.0,
      },
    });
    const proj = resolveBoardProjection(game);
    assert.equal(proj.displayKind, "FBIS");
    assert.equal(proj.kind, "FBIS");
    assert.match(proj.headlineLabel, /FBIS/);
    assert.notEqual(proj.displayKind, "PINNACLE_IMPLIED");
    assert.equal(proj.away, 30.3);
    assert.equal(proj.home, 30.7);
    // Market benchmark remains available separately.
    assert.equal(proj.marketBenchmark?.available, true);

    const view = buildGameWorkspaceView({
      ...game,
      projAway: 30.3,
      projHome: 30.7,
    });
    assert.equal(view.event.model.projectionKind, "FBIS");
    assert.notEqual(view.event.model.projectionKind, "PINNACLE_IMPLIED");
  });

  it("suppresses P(home) for research-v0-form without probability authority", () => {
    const game = nflResearchGame();
    assert.equal(boardShowsFairProbability(game), false);
    const view = buildGameWorkspaceView({
      ...game,
      projAway: 30.3,
      projHome: 30.7,
      pHome: 0.55,
    });
    assert.equal(view.event.model.showFairProbability, false);
    assert.equal(view.event.model.pHome, null);
  });

  it("promoteNflResearchToBoard clears market pHome and stamps heuristic provenance", () => {
    const { games } = promoteNflResearchToBoard([
      {
        id: "den@kc",
        sport: "nfl",
        home: { abbr: "KC" },
        away: { abbr: "DEN" },
        projectionKind: "PINNACLE_IMPLIED",
        model: {
          projHome: 24,
          projAway: 21,
          projectionKind: "PINNACLE_IMPLIED",
          pHomeFinal: 0.62,
        },
        projHomeScore: 24,
        projAwayScore: 21,
        nflShadow: { ok: true, home: 27.1, away: 23.4 },
        odds: { pinSpread: -6, pinTotal: 48 },
      },
    ]);
    const g = games[0];
    assert.equal(g.projectionKind, "FBIS");
    assert.equal(g.model.pHomeFinal, null);
    assert.equal(g.probabilityProvenance?.probabilitySource, "HEURISTIC_SIGMA");
    assert.equal(g.researchProjection?.modelVersion, "research-v0-form");
    assert.equal(resolveBoardProjection(g).available, true);
    assert.equal(boardShowsFairProbability(g), false);
  });

  it("market-only NFL still reports unavailable FBIS projection", () => {
    const game = {
      id: "mkt",
      sport: "nfl",
      projectionKind: "PINNACLE_IMPLIED",
      model: {
        projAway: 21,
        projHome: 24,
        projectionKind: "PINNACLE_IMPLIED",
        marketProjAway: 21,
        marketProjHome: 24,
      },
      marketProjAway: 21,
      marketProjHome: 24,
    };
    const proj = resolveBoardProjection(game);
    assert.equal(proj.available, false);
    assert.equal(hasPureFbisProjection(game), false);
    assert.equal(proj.marketBenchmark?.available, true);
  });
});
