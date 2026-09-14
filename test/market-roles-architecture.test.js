/**
 * Market-role architecture: Pinnacle is REFERENCE only.
 * Operational market = configured execution OR consensus/observed.
 * Heritage is a supported provider — never the implicit default execution book.
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
  selectExecutionOffer,
  MARKET_ROLE,
  DEFAULT_OPERATOR_EXECUTION_BOOKS,
  MARKET_FRESHNESS_MS,
  inferFreshness,
  isFreshEnough,
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

const HERITAGE_ODDS = {
  pinPresent: false,
  heritageListed: true,
  heritageHomeMl: -110,
  heritageAwayMl: -110,
  heritageSpreadHomePrice: -110,
  spread: 3,
  total: 61,
  heritageOverPrice: -110,
};

describe("market roles — operator books default", () => {
  it("canonical default has no configured execution books", () => {
    assert.deepEqual([...DEFAULT_OPERATOR_EXECUTION_BOOKS], []);
  });

  it("no configured operator books → executionMarketAvailable = false", () => {
    const market = resolveCanonicalMarket(fbisGame({ odds: { pinPresent: false } }));
    assert.equal(market.executionMarketAvailable, false);
    assert.deepEqual(market.operatorExecutionBooks, []);
    assert.equal(market.executionActionable, false);
    assert.equal(market.authority.canEnterYourBet, false);
  });

  it("Heritage data alone does not become execution unless Heritage is configured", () => {
    const market = resolveCanonicalMarket(fbisGame({ odds: { ...HERITAGE_ODDS } }));
    assert.equal(market.executionMarketAvailable, false);
    assert.equal(market.execution.available, false);
    assert.equal(market.marketAvailable, true, "Heritage observation may support research/consensus");
    assert.notEqual(market.comparisonMarketRole, MARKET_ROLE.EXECUTION);
    assert.equal(market.authority.canSupportEv, false);
    assert.equal(market.authority.canQualify, false);
    assert.equal(market.authority.canAuthorize, false);
    assert.equal(market.authority.canEnterYourBet, false);
    assert.equal(market.authority.consensusExecutable, false);
  });

  it("configured Heritage → execution works", () => {
    const game = fbisGame({
      odds: { ...HERITAGE_ODDS },
      operatorExecutionBooks: ["heritage"],
      marketObservedAt: new Date().toISOString(),
    });
    const market = resolveCanonicalMarket(game);
    assert.equal(market.executionMarketAvailable, true);
    assert.equal(market.execution.book, "Heritage");
    assert.equal(market.execution.spread, 3);
    assert.equal(market.executionActionable, true);
    assert.equal(market.authority.canEnterYourBet, true);
    assert.equal(market.marketAvailable, true);
    assert.equal(market.comparisonMarketRole, MARKET_ROLE.EXECUTION);

    const board = toBoardGame(game, "nfl");
    assert.equal(board.marketUnavailable, false);
    assert.equal(board.executionMarketAvailable, true);
  });
});

describe("market roles — availability matrix", () => {
  it("FBIS + configured execution market + no Pinnacle works normally", () => {
    const game = fbisGame({
      odds: { ...HERITAGE_ODDS },
      operatorExecutionBooks: ["heritage"],
      marketObservedAt: new Date().toISOString(),
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

  it("ACTION consensus + no execution → marketAvailable true, executionMarketAvailable false", () => {
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
    assert.equal(market.executionMarketAvailable, false);
    assert.equal(market.consensus.available, true);
    assert.equal(market.consensus.source, "ACTION");
    assert.equal(market.consensus.executable, false);
    assert.equal(market.referenceMarketAvailable, false);
    assert.equal(market.intelligence.available, true);
    assert.equal(market.intelligence.sharpLabel, null);
    assert.equal(market.intelligence.publicPositioningLabel, "PUBLIC_POSITIONING");
    assert.equal(market.authority.canSupportModelVsMarket, true);
    assert.equal(market.authority.canSupportEv, false);
    assert.equal(market.authority.canQualify, false);
    assert.equal(market.authority.canAuthorize, false);
    assert.equal(market.authority.canEnterYourBet, false);
    assert.equal(market.authority.requiresExecutionForYourBet, true);

    const board = toBoardGame(game, "nfl");
    assert.equal(board.marketUnavailable, false);
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
  });

  it("reference-only Pinnacle → marketAvailable false, referenceMarketAvailable true", () => {
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
    assert.equal(market.executionMarketAvailable, false);

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
    assert.equal(market.executionMarketAvailable, false);

    const board = toBoardGame(game, "nfl");
    assert.equal(board.marketUnavailable, true);
    assert.equal(board.projectionUnavailable, false);

    const decision = deriveDecisionState(board);
    assert.notEqual(decision.state, "UNAVAILABLE");
    assert.equal(resolveBoardProjection(game).available, true);
  });

  it("No FBIS + observed/consensus market → market displays; no independent FBIS projection", () => {
    const game = {
      id: "mkt-only",
      sport: "nfl",
      start: "2026-09-14T17:00:00Z",
      home: { abbr: "NYG" },
      away: { abbr: "DAL" },
      status: {},
      projectionKind: "UNAVAILABLE",
      model: {},
      odds: { ...HERITAGE_ODDS },
    };
    const market = resolveCanonicalMarket(game);
    assert.equal(market.marketAvailable, true);
    assert.equal(market.executionMarketAvailable, false);
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
        ...HERITAGE_ODDS,
        pinPresent: true,
        pinHomeMl: -120,
        pinAwayMl: 100,
      },
      operatorExecutionBooks: ["heritage"],
    });
    assert.equal(boardShowsFairProbability(game), false);
    const elig = publicationEligibilityForGame(game);
    assert.equal(elig.canQualify, false);
    assert.equal(elig.canAuthorizeWager, false);
  });

  it("Missing Pinnacle ML does not globally mark event broken", () => {
    const game = fbisGame({
      odds: { ...HERITAGE_ODDS },
      operatorExecutionBooks: ["heritage"],
      marketObservedAt: new Date().toISOString(),
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
    assert.equal(Number(game.marketProjAway), 25.3);
    assert.equal(Number(game.marketProjHome), 22.3);
  });
});

describe("market roles — freshness + offer semantics", () => {
  it("role-aware freshness thresholds differ by role", () => {
    assert.ok(MARKET_FRESHNESS_MS.EXECUTION < MARKET_FRESHNESS_MS.CONSENSUS);
    assert.ok(MARKET_FRESHNESS_MS.CONSENSUS < MARKET_FRESHNESS_MS.REFERENCE);
    const now = Date.parse("2026-09-14T12:00:00Z");
    const twoHoursAgo = "2026-09-14T10:00:00Z";
    assert.equal(inferFreshness(twoHoursAgo, "EXECUTION", now), "STALE");
    assert.equal(inferFreshness(twoHoursAgo, "CONSENSUS", now), "OK");
    assert.equal(inferFreshness(twoHoursAgo, "REFERENCE", now), "OK");
    assert.equal(isFreshEnough(twoHoursAgo, "EXECUTION", now), false);
    assert.equal(isFreshEnough(twoHoursAgo, "CONSENSUS", now), true);
  });

  it("stale execution observation cannot become actionable", () => {
    const staleAt = "2026-09-13T01:00:00Z";
    const now = Date.parse("2026-09-14T12:00:00Z");
    const market = resolveCanonicalMarket(
      fbisGame({
        odds: { ...HERITAGE_ODDS },
        operatorExecutionBooks: ["heritage"],
        marketObservedAt: staleAt,
      }),
      { now }
    );
    assert.equal(market.executionMarketAvailable, true, "stale execution may remain visible");
    assert.equal(market.execution.available, true);
    assert.equal(market.execution.freshness, "STALE");
    assert.equal(market.executionActionable, false);
    assert.equal(market.execution.actionable, false);
    assert.equal(market.authority.canEnterYourBet, false);
    assert.match(String(market.primaryMarketLabel), /STALE/i);
  });

  it("like-for-like lines may claim BEST EXECUTION; mixed lines may not", () => {
    const like = selectExecutionOffer([
      { book: "Heritage", selection: "home_spread", line: 3, price: -120 },
      { book: "Heritage", selection: "home_spread", line: 3, price: -105 },
    ]);
    assert.equal(like.line, 3);
    assert.equal(like.price, -105);
    assert.equal(like.likeForLike, true);
    assert.equal(like.label, "BEST EXECUTION");
    assert.equal(like.comparisonNote, "line_and_price_coupled");

    const mixed = selectExecutionOffer([
      { book: "Heritage", selection: "home_spread", line: 3, price: -120 },
      { book: "Heritage", selection: "home_spread", line: 2.5, price: -102 },
    ]);
    assert.equal(mixed.likeForLike, false);
    assert.equal(mixed.label, "AVAILABLE OFFER");
    assert.match(mixed.comparisonNote, /no_valuation|mixed/i);
    assert.notEqual(mixed.label, "BEST EXECUTION");

    const bestAlias = selectBestExecutionOffer([
      { book: "Heritage", selection: "home_spread", line: 3, price: -120 },
      { book: "Heritage", selection: "home_spread", line: 2.5, price: -102 },
    ]);
    assert.equal(bestAlias.label, "AVAILABLE OFFER");
  });

  it("best execution offer keeps line and price coupled on like-for-like", () => {
    const best = selectBestExecutionOffer([
      { book: "Heritage", selection: "home_spread", line: 3, price: -120 },
      { book: "Heritage", selection: "home_spread", line: 3, price: -105 },
    ]);
    assert.equal(best.line, 3);
    assert.equal(best.price, -105);
    assert.equal(best.comparisonNote, "line_and_price_coupled");
    assert.equal(best.label, "BEST EXECUTION");
  });
});

describe("market roles — comparison hierarchy + quality", () => {
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

  it("quality components isolate reference gaps when execution is configured", () => {
    const game = fbisGame({
      odds: { ...HERITAGE_ODDS },
      operatorExecutionBooks: ["heritage"],
      marketObservedAt: new Date().toISOString(),
    });
    const market = resolveCanonicalMarket(game);
    const q = resolveMarketQualityComponents(game, market);
    assert.equal(q.referenceMarketQuality.state, "MISSING");
    assert.equal(q.executionMarketQuality.state, "READY");
    assert.notEqual(q.overallState, "BLOCKED");
    assert.ok(q.operationalScore >= 70);
  });

  it("unconfigured Heritage does not report READY execution quality", () => {
    const game = fbisGame({ odds: { ...HERITAGE_ODDS } });
    const market = resolveCanonicalMarket(game);
    const q = resolveMarketQualityComponents(game, market);
    assert.equal(q.executionMarketQuality.state, "MISSING");
    assert.equal(q.overallState, "CONSENSUS_ONLY");
  });
});

describe("market roles — publication", () => {
  it("research publication remains unaffected without Pinnacle or execution config", () => {
    const game = fbisGame({
      odds: { ...HERITAGE_ODDS },
    });
    game.market = resolveCanonicalMarket(game);
    assert.equal(game.market.executionMarketAvailable, false);
    assert.equal(game.market.marketAvailable, true);
    const elig = publicationEligibilityForGame(game);
    assert.equal(elig.eligible, true);
    assert.equal(elig.status, "RESEARCH_PUBLISHABLE");
    const copy = buildXGameCopy(game, "nfl");
    assert.equal(copy.ok, true);
    assert.match(copy.text, /FBIS/i);
    assert.doesNotMatch(copy.text, /Pinnacle/i);
  });

  it("research publication does not require Pinnacle when Heritage is configured", () => {
    const game = fbisGame({
      odds: { ...HERITAGE_ODDS },
      operatorExecutionBooks: ["heritage"],
      marketObservedAt: new Date().toISOString(),
    });
    game.market = resolveCanonicalMarket(game);
    const elig = publicationEligibilityForGame(game);
    assert.equal(elig.eligible, true);
    assert.equal(elig.status, "RESEARCH_PUBLISHABLE");
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
