/**
 * Market-role architecture: Pinnacle is REFERENCE only.
 * Operational market = execution (Heritage) OR consensus (ACTION/soft).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCanonicalMarket,
  marketAvailabilitySummary,
  normalizeQualityFlags,
  resolveMarketQualityComponents,
  resolveComparisonMarket,
  selectBestExecutionOffer,
  MARKET_ROLE,
} from "../functions/lib/canonical/marketRoles.js";
import { toBoardGame } from "../functions/lib/todayBoard.js";
import { dataQuality } from "../functions/lib/slateEngineCore.js";
import {
  marketLines,
  resolveBoardProjection,
  boardShowsFairProbability,
  fbisProjection,
} from "../src/lib/boardDecision.js";
import { deriveDecisionState } from "../functions/lib/fbisDomain.js";
import {
  publicationEligibilityForGame,
  buildXGameCopy,
} from "../functions/lib/xPublication.js";

function fbisGame(over = {}) {
  return {
    id: "nfl-dal-nyg",
    sport: "nfl",
    start: "2026-09-14T17:00:00Z",
    home: { name: "Giants", abbr: "NYG", fullName: "New York Giants" },
    away: { name: "Cowboys", abbr: "DAL", fullName: "Dallas Cowboys" },
    status: { detail: "Scheduled" },
    projectionKind: "FBIS",
    projectionMaturity: "RESEARCH",
    model: {
      projAway: 30.3,
      projHome: 30.7,
      projTotal: 61.0,
      projMargin: 0.4,
      projectionKind: "FBIS",
      maturity: "RESEARCH",
      recipe: "research-v0-form",
      modelId: "NFL-FBIS-PURE",
    },
    projAwayScore: 30.3,
    projHomeScore: 30.7,
    pureProjectionAvailable: true,
    canQualify: false,
    ...over,
  };
}

describe("market roles — availability matrix", () => {
  it("FBIS + execution market + no Pinnacle works normally", () => {
    const game = fbisGame({
      odds: {
        pinPresent: false,
        heritageListed: true,
        heritageHomeMl: -110,
        heritageAwayMl: -110,
        heritageSpreadHomePrice: -110,
        spread: 3,
        total: 61,
        heritageOverPrice: -110,
      },
    });
    const market = resolveCanonicalMarket(game);
    assert.equal(market.marketAvailable, true);
    assert.equal(market.executionMarketAvailable, true);
    assert.equal(market.referenceMarketAvailable, false);
    assert.equal(market.execution.book, "Heritage");
    assert.equal(market.execution.spread, 3);

    const board = toBoardGame(game, "nfl");
    assert.equal(board.marketUnavailable, false);
    assert.equal(board.executionMarketAvailable, true);
    assert.equal(board.referenceMarketAvailable, false);

    const proj = resolveBoardProjection({ ...game, market });
    assert.equal(proj.available, true);
    assert.match(String(proj.headlineLabel), /FBIS/i);
    assert.equal(boardShowsFairProbability({ ...game, market }), false);

    const decision = deriveDecisionState(board);
    assert.equal(decision.state, "RESEARCH");
  });

  it("FBIS + ACTION consensus + no Pinnacle works normally", () => {
    const game = fbisGame({
      odds: { pinPresent: false },
      actionIntel: {
        consensus: { spreadHome: 3, total: 61, bookCount: 8 },
        publicSplits: { ticketPct: 62, moneyPct: 55, moneyTicketGap: -7 },
        collectedAt: new Date().toISOString(),
      },
    });
    const market = resolveCanonicalMarket(game);
    assert.equal(market.marketAvailable, true);
    assert.equal(market.consensus.available, true);
    assert.equal(market.consensus.source, "ACTION");
    assert.equal(market.referenceMarketAvailable, false);
    assert.equal(market.intelligence.available, true);
    assert.equal(market.intelligence.sharpLabel, null);
    assert.equal(market.intelligence.publicPositioningLabel, "PUBLIC_POSITIONING");

    const board = toBoardGame(game, "nfl");
    assert.equal(board.marketUnavailable, false);
  });

  it("FBIS + Pinnacle + no execution market → projection displays; execution unavailable", () => {
    const game = fbisGame({
      odds: {
        pinPresent: true,
        pinSpread: -3,
        pinTotal: 45,
        pinHomeMl: -150,
        pinAwayMl: 130,
        heritageListed: false,
      },
    });
    const market = resolveCanonicalMarket(game);
    assert.equal(market.marketAvailable, false, "Pinnacle alone must not define marketAvailable");
    assert.equal(market.referenceMarketAvailable, true);
    assert.equal(market.executionMarketUnavailable, true);

    const board = toBoardGame(game, "nfl");
    assert.equal(board.marketUnavailable, true);
    assert.equal(board.referenceMarketAvailable, true);
    assert.equal(board.executionMarketUnavailable, true);

    const proj = fbisProjection(game);
    assert.equal(proj.available, true);
    assert.equal(proj.away, 30.3);
    assert.equal(proj.home, 30.7);

    const lines = marketLines({ ...game, market });
    assert.equal(lines.referenceOnly, true);
    assert.equal(lines.marketAvailable, false);
    assert.notEqual(lines.book, "Pinnacle");
  });

  it("FBIS + no market anywhere → projection still displays", () => {
    const game = fbisGame({ odds: { pinPresent: false } });
    const market = resolveCanonicalMarket(game);
    assert.equal(market.marketAvailable, false);
    assert.equal(market.referenceMarketAvailable, false);

    const board = toBoardGame(game, "nfl");
    assert.equal(board.marketUnavailable, true);
    assert.equal(board.projectionUnavailable, false);

    const decision = deriveDecisionState(board);
    assert.notEqual(decision.state, "UNAVAILABLE");
    assert.equal(resolveBoardProjection(game).available, true);
  });

  it("No FBIS + market → market displays; no independent FBIS projection", () => {
    const game = {
      id: "mkt-only",
      sport: "nfl",
      start: "2026-09-14T17:00:00Z",
      home: { abbr: "NYG" },
      away: { abbr: "DAL" },
      status: {},
      projectionKind: "UNAVAILABLE",
      model: {},
      odds: {
        pinPresent: false,
        heritageListed: true,
        heritageHomeMl: -110,
        heritageAwayMl: -110,
        heritageSpreadHomePrice: -110,
        spread: 3,
      },
    };
    const market = resolveCanonicalMarket(game);
    assert.equal(market.marketAvailable, true);
    const board = toBoardGame(game, "nfl");
    assert.equal(board.marketUnavailable, false);
    assert.equal(board.projectionUnavailable, true);
    assert.equal(resolveBoardProjection(game).available, false);
  });

  it("Pinnacle implied only is never labeled FBIS", () => {
    const game = {
      id: "pin-implied",
      sport: "nfl",
      projectionKind: "PINNACLE_IMPLIED",
      model: {
        projectionKind: "PINNACLE_IMPLIED",
        marketProjAway: 25.3,
        marketProjHome: 22.3,
      },
      marketProjAway: 25.3,
      marketProjHome: 22.3,
      odds: { pinPresent: true, pinSpread: -3, pinTotal: 47.5 },
    };
    const proj = resolveBoardProjection(game);
    assert.equal(proj.available, false);
    assert.doesNotMatch(String(proj.headlineLabel || ""), /FBIS/i);
    assert.notEqual(proj.displayKind, "FBIS");
  });

  it("Research model does not gain probability/EV/qualification from market presence", () => {
    const game = fbisGame({
      odds: {
        pinPresent: true,
        pinHomeMl: -120,
        pinAwayMl: 100,
        heritageListed: true,
        heritageHomeMl: -110,
        heritageAwayMl: -110,
        heritageSpreadHomePrice: -110,
        spread: 3,
      },
    });
    assert.equal(boardShowsFairProbability(game), false);
    const elig = publicationEligibilityForGame(game);
    assert.equal(elig.canQualify, false);
    assert.equal(elig.canAuthorizeWager, false);
  });

  it("Missing Pinnacle ML does not globally mark event broken", () => {
    const game = fbisGame({
      odds: {
        pinPresent: false,
        heritageListed: true,
        heritageHomeMl: -110,
        heritageAwayMl: -110,
        spread: 3,
        heritageSpreadHomePrice: -110,
      },
      pin: { ml: { complete: false } },
    });
    const dq = dataQuality("nfl", game);
    assert.ok(dq.flags.includes("reference_market_incomplete_ml"));
    assert.ok(!dq.operationalFlags.includes("reference_market_incomplete_ml"));
    assert.equal(dq.score, 100);
    const flags = normalizeQualityFlags(["incomplete_pin_ml"]);
    assert.ok(flags.includes("reference_market_incomplete_ml"));
    assert.ok(!flags.includes("incomplete_pin_ml"));
  });

  it("Historical market-implied benchmark remains readable beside FBIS", () => {
    const game = fbisGame({
      marketProjAway: 25.3,
      marketProjHome: 22.3,
      model: {
        ...fbisGame().model,
        marketProjAway: 25.3,
        marketProjHome: 22.3,
      },
    });
    const proj = resolveBoardProjection(game);
    assert.equal(proj.available, true);
    assert.equal(proj.kind, "FBIS");
    assert.notEqual(proj.kind, "PINNACLE_IMPLIED");
    assert.equal(proj.away, 30.3);
    assert.equal(proj.home, 30.7);
    // Preserve readable market-implied context without promoting it to FBIS.
    assert.equal(Number(game.marketProjAway), 25.3);
    assert.equal(Number(game.marketProjHome), 22.3);
  });
});

describe("market roles — comparison hierarchy + best price", () => {
  it("comparison prefers execution, then consensus, then reference", () => {
    const execution = {
      available: true,
      spread: 3,
      total: 61,
      book: "Heritage",
      observedAt: "2026-09-13T12:00:00Z",
      moneyline: { home: -110, away: -110 },
    };
    const consensus = {
      available: true,
      spread: 2.5,
      total: 60,
      source: "ACTION",
      observedAt: "2026-09-13T12:05:00Z",
    };
    const reference = {
      available: true,
      spread: -3,
      total: 45,
      provider: "Pinnacle",
      observedAt: "2026-09-13T11:00:00Z",
      moneyline: { home: -150, away: 130 },
    };
    const a = resolveComparisonMarket({ execution, consensus, reference });
    assert.equal(a.role, MARKET_ROLE.EXECUTION);
    assert.equal(a.offer.spread, 3);

    const b = resolveComparisonMarket({
      execution: { available: false },
      consensus,
      reference,
    });
    assert.equal(b.role, MARKET_ROLE.CONSENSUS);

    const c = resolveComparisonMarket({
      execution: { available: false },
      consensus: { available: false },
      reference,
    });
    assert.equal(c.role, MARKET_ROLE.REFERENCE);
    assert.equal(c.source, "Pinnacle");
  });

  it("best execution offer keeps line and price coupled", () => {
    const best = selectBestExecutionOffer([
      { book: "Heritage", selection: "home_spread", line: 3, price: -120 },
      { book: "Heritage", selection: "home_spread", line: 3, price: -105 },
      { book: "Heritage", selection: "home_spread", line: 2.5, price: -102 },
    ]);
    assert.equal(best.line, 3);
    assert.equal(best.price, -105);
    assert.equal(best.comparisonNote, "line_and_price_coupled");
  });

  it("quality components isolate reference gaps", () => {
    const game = fbisGame({
      odds: {
        pinPresent: false,
        heritageListed: true,
        heritageHomeMl: -110,
        heritageAwayMl: -110,
        spread: 3,
        heritageSpreadHomePrice: -110,
      },
    });
    const market = resolveCanonicalMarket(game);
    const q = resolveMarketQualityComponents(game, market);
    assert.equal(q.referenceMarketQuality.state, "MISSING");
    assert.equal(q.executionMarketQuality.state, "READY");
    assert.notEqual(q.overallState, "BLOCKED");
    assert.ok(q.operationalScore >= 70);
  });
});

describe("market roles — publication", () => {
  it("research publication does not require Pinnacle", () => {
    const game = fbisGame({
      odds: {
        pinPresent: false,
        heritageListed: true,
        heritageHomeMl: -110,
        heritageAwayMl: -110,
        spread: 3,
        heritageSpreadHomePrice: -110,
      },
    });
    game.market = resolveCanonicalMarket(game);
    const elig = publicationEligibilityForGame(game);
    assert.equal(elig.eligible, true);
    assert.equal(elig.status, "RESEARCH_PUBLISHABLE");
    const copy = buildXGameCopy(game, "nfl");
    assert.equal(copy.ok, true);
    assert.match(copy.text, /FBIS/i);
    assert.doesNotMatch(copy.text, /Pinnacle/i);
  });

  it("availability summary labels are precise", () => {
    const market = resolveCanonicalMarket(
      fbisGame({
        odds: { pinPresent: true, pinSpread: -3, pinHomeMl: -150, pinAwayMl: 130 },
      })
    );
    const s = marketAvailabilitySummary(market);
    assert.equal(s.marketAvailable, false);
    assert.equal(s.referenceMarketAvailable, true);
    assert.match(s.labels.market, /OPERATIONAL MARKET UNAVAILABLE/);
    assert.match(s.labels.execution, /EXECUTION MARKET UNAVAILABLE/);
    assert.match(s.labels.reference, /AVAILABLE|available/i);
  });
});
