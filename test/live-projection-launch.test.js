import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  promoteMlbResearchToBoard,
  promoteNflResearchToBoard,
  promoteCbbResearchToBoard,
  modelMarketDisagreement,
} from "../functions/lib/researchBoardPromote.js";
import { qualificationIntegrity } from "../functions/lib/slateEngine.js";
import {
  buildXGameCopy,
  buildXSlateCopy,
  buildTopDisagreementsCopy,
  publicationEligibilityForGame,
} from "../functions/lib/xPublication.js";
import {
  boardDecision,
  hasPureFbisProjection,
  isResearchProjection,
} from "../src/lib/boardDecision.js";
import { productProjectionCard } from "../functions/lib/productProjection.js";

describe("live research projection launch", () => {
  it("promotes MLB deep research onto the board without wager authority", () => {
    const { games, meta } = promoteMlbResearchToBoard([
      {
        id: "mlb-1",
        sport: "mlb",
        home: { abbr: "HOU", name: "Astros" },
        away: { abbr: "SEA", name: "Mariners" },
        odds: { pinSpread: -1.5, pinTotal: 8.5 },
        mlbDeepShadow: { ok: true, home: 4.6, away: 3.8, version: "v1" },
      },
    ]);
    const g = games[0];
    assert.equal(meta.promoted, 1);
    assert.equal(g.projectionKind, "FBIS");
    assert.equal(g.projectionMaturity, "RESEARCH");
    assert.equal(g.canQualify, false);
    assert.equal(g.publicationStatus, "RESEARCH_PUBLISHABLE");
    assert.equal(g.projHomeScore, 4.6);
    assert.equal(g.projAwayScore, 3.8);
    assert.equal(g.model?.recipe?.engine, "MLB-RUN-ALLOC-v1");
    const qi = qualificationIntegrity("mlb", g);
    assert.equal(qi.ok, false);
    assert.match(String(qi.code || qi.reasonCode || qi.reason), /research|wager|authority|no-wager/i);
  });

  it("promotes NFL form research onto the board without wager authority", () => {
    const { games, meta } = promoteNflResearchToBoard([
      {
        id: "nfl-1",
        sport: "nfl",
        home: { abbr: "MIN", name: "Vikings" },
        away: { abbr: "GB", name: "Packers" },
        odds: { pinSpread: -1.5, pinTotal: 46.5 },
        nflShadow: { ok: true, home: 22.7, away: 24.1 },
        challengers: { "NFL-TEAM-FORM-v0": { ok: true, home: 22.7, away: 24.1 } },
      },
    ]);
    const g = games[0];
    assert.equal(meta.promoted, 1);
    assert.equal(g.projectionKind, "FBIS");
    assert.equal(g.projectionMaturity, "RESEARCH");
    assert.equal(g.canQualify, false);
    assert.equal(g.publicationStatus, "RESEARCH_PUBLISHABLE");
    assert.equal(g.projHomeScore, 22.7);
    assert.equal(g.projAwayScore, 24.1);
    assert.equal(g.model?.recipe?.engine, "NFL-FBIS-PURE");
    assert.equal(typeof g.model?.recipe, "object");
    const qi = qualificationIntegrity("nfl", g);
    assert.equal(qi.ok, false);
    assert.match(String(qi.code || qi.reasonCode || qi.reason), /research|wager|authority|no-wager/i);
  });

  it("freezes NFL research with NFL-FBIS-PURE engine (not unknown)", async () => {
    const { freezeFromGame } = await import("../functions/lib/projLedger.js");
    const { games } = promoteNflResearchToBoard([
      {
        id: "nfl-freeze-1",
        sport: "nfl",
        home: { abbr: "MIN", name: "Vikings", school: "Minnesota" },
        away: { abbr: "GB", name: "Packers", school: "Green Bay" },
        start: "2026-09-13T20:25:00Z",
        nflShadow: { ok: true, home: 19.7, away: 19.3 },
        challengers: { "NFL-TEAM-FORM-v0": { ok: true, home: 19.7, away: 19.3 } },
      },
    ]);
    const frozen = freezeFromGame("2026-09-13", games[0]);
    assert.ok(frozen);
    assert.equal(frozen.engine, "NFL-FBIS-PURE");
    assert.equal(frozen.projectionKind, "FBIS");
    assert.equal(frozen.projHome, 19.7);
    assert.equal(frozen.projAway, 19.3);
    // Legacy string recipes from earlier deploys must still resolve.
    const legacy = freezeFromGame("2026-09-13", {
      id: "nfl-legacy",
      sport: "nfl",
      away: { abbr: "GB" },
      home: { abbr: "MIN" },
      projectionKind: "FBIS",
      model: {
        projHome: 19.7,
        projAway: 19.3,
        recipe: "NFL-FBIS-PURE@research-v0-form",
        projectionKind: "FBIS",
      },
    });
    assert.equal(legacy.engine, "NFL-FBIS-PURE");
  });

  it("computes model-market disagreement with documented home convention", () => {
    const d = modelMarketDisagreement({
      projHome: 24.1,
      projAway: 22.7,
      marketHomeSpread: -1.5,
      marketTotal: 46.5,
    });
    assert.equal(d.side, -0.1);
    assert.equal(d.total, 0.3);
  });

  it("strips CBB pinnacle-implied masquerade when ratings are missing", () => {
    const { games } = promoteCbbResearchToBoard(
      [
        {
          id: "cbb-1",
          sport: "cbb",
          home: { name: "Duke" },
          away: { name: "UNC" },
          projectionKind: "PINNACLE_IMPLIED",
          model: { projectionKind: "PINNACLE_IMPLIED", projHome: 78, projAway: 74 },
          projHomeScore: 78,
          projAwayScore: 74,
        },
      ],
      null
    );
    const g = games[0];
    assert.equal(g.projectionKind, "UNAVAILABLE");
    assert.equal(g.projHomeScore, null);
    assert.equal(g.publicationStatus, "NOT_PUBLISHABLE");
  });

  it("board shows RESEARCH not PASS for research NFL projections", () => {
    const game = {
      sport: "nfl",
      projectionKind: "FBIS",
      projectionMaturity: "RESEARCH",
      publicationStatus: "RESEARCH_PUBLISHABLE",
      canQualify: false,
      qualificationBlocked: true,
      researchProjection: { modelId: "NFL-FBIS-PURE" },
      model: { projHome: 22.7, projAway: 24.1, projectionKind: "FBIS", maturity: "RESEARCH" },
      projHomeScore: 22.7,
      projAwayScore: 24.1,
    };
    assert.equal(isResearchProjection(game), true);
    assert.equal(hasPureFbisProjection(game), true);
    const d = boardDecision(game);
    assert.equal(d.tier, "RESEARCH");
    assert.notEqual(d.tier, "PASS");
    assert.notEqual(d.tier, "NO_MODEL");
  });

  it("product card marks NFL research independent without EV", () => {
    const card = productProjectionCard(
      {
        id: "n1",
        projectionKind: "FBIS",
        projectionMaturity: "RESEARCH",
        canQualify: false,
        researchProjection: { modelId: "NFL-FBIS-PURE" },
        model: { projHome: 21, projAway: 24, projectionKind: "FBIS", maturity: "RESEARCH" },
        projHomeScore: 21,
        projAwayScore: 24,
        home: { name: "Home" },
        away: { name: "Away" },
      },
      "nfl",
      { tier: "public" }
    );
    assert.equal(card.model.independent, true);
    assert.equal(card.model.maturity, "RESEARCH");
    assert.equal(card.projection.independent, true);
    assert.equal(card.projection.pHome, null);
  });

  it("builds X research copy without banned phrases or fake EV", () => {
    const game = {
      id: "nfl-x",
      sport: "nfl",
      projectionKind: "FBIS",
      projectionMaturity: "RESEARCH",
      canQualify: false,
      pureProjectionAvailable: true,
      home: { abbr: "MIN", name: "Vikings" },
      away: { abbr: "GB", name: "Packers" },
      model: { projHome: 22.7, projAway: 24.1, projectionKind: "FBIS" },
      projHomeScore: 22.7,
      projAwayScore: 24.1,
      odds: { pinSpread: -1.5, pinTotal: 46.5 },
      researchProjection: { modelId: "NFL-FBIS-PURE", modelVersion: "research-v0-form" },
    };
    assert.equal(publicationEligibilityForGame(game).status, "RESEARCH_PUBLISHABLE");
    const built = buildXGameCopy(game, "nfl");
    assert.equal(built.ok, true);
    assert.match(built.text, /Status: Research/);
    assert.doesNotMatch(built.text, /\bEV\b|fair odds|lock|guaranteed/i);
    const slate = buildXSlateCopy([game], "nfl");
    assert.match(slate.text, /research/i);
    const top = buildTopDisagreementsCopy([game]);
    assert.match(top.text, /Disagree/i);
  });
});
