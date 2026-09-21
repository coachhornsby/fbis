import test from "node:test";
import assert from "node:assert/strict";
import {
  DECISION_STATES,
  deriveDecisionState,
  recommendMovementStorage,
  toDomainEvent,
  toDomainPlayerMarket,
  toDomainTodayBoard,
  toDomainMarketQuote,
} from "../functions/lib/fbisDomain.js";

test("domain market quote never invents prices or timestamps", () => {
  const q = toDomainMarketQuote({ marketType: "spread", side: "home", line: -3.5 });
  assert.equal(q.line, -3.5);
  assert.equal(q.price, null);
  assert.equal(q.sourceObservedAt, null);
  assert.equal(q.book, null);
});

test("player market keeps provider/fbis ids separate and decisionEligible false", () => {
  const row = toDomainPlayerMarket({
    provider: "ACTION_APIFY",
    providerPlayerId: "p1",
    playerName: "Test QB",
    marketCanonical: "passing_yards",
    line: 249.5,
    overOdds: -110,
    underOdds: -110,
    book: "draftkings",
  });
  assert.equal(row.providerPlayerId, "p1");
  assert.equal(row.fbisPlayerId, null);
  assert.equal(row.imageUrl, null);
  assert.equal(row.decisionEligible, false);
  assert.ok(row.reasonCodes.includes("NOT_DECISION_ELIGIBLE"));
});

test("decision state maps board flags without inventing qualification", () => {
  assert.equal(deriveDecisionState({ rec: { qualified: true } }).state, "QUALIFIED");
  assert.equal(
    deriveDecisionState({ lean: { pick: "HOME", reason: "EDGE_LOW" } }).state,
    "WATCHLIST",
  );
  assert.equal(
    deriveDecisionState({ qualificationBlocked: true, blockReason: "NFL_MODEL" }).state,
    "BLOCKED",
  );
  assert.equal(deriveDecisionState({ projectionUnavailable: true }).state, "UNAVAILABLE");
  assert.equal(deriveDecisionState({ noPlayReason: "NO_EDGE" }).state, "PASS");
  assert.equal(deriveDecisionState({}).state, "RESEARCH");
});

test("toDomainEvent builds Event contract from today board game", () => {
  const event = toDomainEvent({
    id: "401628349",
    sport: "cfb",
    sportLabel: "CFB",
    start: "2026-09-13T19:00:00Z",
    status: "scheduled",
    away: { name: "Ohio State", abbr: "OHIO", canonicalId: "osu" },
    home: { name: "Texas", abbr: "TEX", canonicalId: "tex" },
    projHome: 27.2,
    projAway: 23.1,
    projMargin: 4.1,
    pinSpread: -2.5,
    pinSpreadHomePrice: -110,
    pinMlHome: -130,
    pinMlAway: 110,
    pinTotal: 51.5,
    pinOverPrice: -105,
    bettingAllowed: true,
    lean: { pick: "HOME", market: "spread", reason: "EDGE_BELOW_THRESHOLD" },
  });
  assert.equal(event.id, "401628349");
  assert.equal(event.teams.home.abbr, "TEX");
  assert.equal(event.model.projMargin, 4.1);
  assert.equal(event.decision.state, "WATCHLIST");
  assert.equal(event.decision.authorized, false);
  assert.ok(event.consensusMarkets.some((m) => m.marketType === "spread"));
  assert.equal(event.provenance.schemaVersion, "fbis-event-v1");
});

test("domain movement uses canonical operational spread before reference fields", () => {
  const event = toDomainEvent({
    id: "mlb-op-1",
    sport: "mlb",
    away: { abbr: "TOR" },
    home: { abbr: "BAL" },
    projHome: 3.8,
    projAway: 4.1,
    projMargin: -0.3,
    pinSpread: null,
    market: {
      marketAvailable: true,
      execution: { available: false },
      consensus: { available: true, source: "CONSENSUS", spread: 1.5, total: 7.5 },
      reference: { available: false },
    },
    rec: { qualified: true, pick: "TOR", market: "spread", ev: 0.06 },
  });
  assert.equal(event.movement.currentLine, 1.5);
  assert.equal(event.movement.bestLine, 1.5);
  assert.equal(event.publicSplits.ticketPct, null);
  assert.equal(event.publicSplits.moneyPct, null);
});

test("domain event exposes canonical consensus market to Game Workstation", () => {
  const event = toDomainEvent({
    id: "nfl-market-1",
    sport: "nfl",
    away: { abbr: "NYG" },
    home: { abbr: "LAR" },
    projHome: 31.3,
    projAway: 20.9,
    market: {
      marketAvailable: true,
      execution: { available: false },
      consensus: {
        available: true,
        source: "CONSENSUS",
        spread: -7.5,
        total: 48.5,
        observedAt: "2026-09-21T04:00:00Z",
      },
      reference: { available: false },
    },
  }, { generatedAt: "2026-09-21T04:36:00Z" });
  const spread = event.consensusMarkets.find((m) => m.marketType === "spread");
  const total = event.consensusMarkets.find((m) => m.marketType === "total");
  assert.equal(spread.line, -7.5);
  assert.equal(spread.provider, "consensus_market");
  assert.equal(total.line, 48.5);
});

test("domain event suppresses stale ACTION splits while preserving current market", () => {
  const event = toDomainEvent({
    id: "nfl-stale-action",
    sport: "nfl",
    away: { abbr: "NYG" },
    home: { abbr: "LAR" },
    market: {
      marketAvailable: true,
      execution: { available: false },
      consensus: { available: true, source: "CONSENSUS", spread: -7.5, total: 48.5 },
    },
    actionIntel: {
      collectedAt: "2026-09-18T00:50:30.725Z",
      publicSplits: { ticketPct: 30, moneyPct: 33 },
      movement: { openingLine: -6.5, currentLine: -7.5, movementMagnitude: 1 },
      displayOnly: true,
    },
    sentiment: {
      source: "ACTION_APIFY",
      displayOnly: true,
      collectedAt: "2026-09-18T00:50:30.725Z",
      ticketPct: 30,
      moneyPct: 33,
      openingLine: -6.5,
      currentLine: -7.5,
      magnitude: 1,
    },
    publicSplits: { ticketPct: 30, moneyPct: 33 },
  }, { generatedAt: "2026-09-21T04:36:00Z" });
  assert.equal(event.actionIntel, null);
  assert.equal(event.publicSplits.ticketPct, null);
  assert.equal(event.publicSplits.moneyPct, null);
  assert.equal(event.publicSplits.staleActionSuppressed, true);
  assert.equal(event.movement.currentLine, -7.5);
  assert.equal(event.movement.openingLine, null);
});

test("today domain board ranks only real QUALIFIED then WATCHLIST (max 5)", () => {
  const board = toDomainTodayBoard({
    date: "2026-09-13",
    counts: { games: 4, qualified: 1 },
    games: [
      {
        id: "1",
        sport: "cfb",
        away: { abbr: "A" },
        home: { abbr: "B" },
        rec: { qualified: true, pick: "HOME" },
      },
      {
        id: "2",
        sport: "cfb",
        away: { abbr: "C" },
        home: { abbr: "D" },
        lean: { pick: "AWAY" },
      },
      {
        id: "3",
        sport: "nfl",
        away: { abbr: "E" },
        home: { abbr: "F" },
        noPlayReason: "NO_EDGE",
      },
      { id: "4", sport: "mlb", away: { abbr: "G" }, home: { abbr: "H" } },
    ],
  });
  assert.equal(board.events.length, 4);
  assert.equal(board.topGameOpportunities.length, 2);
  assert.equal(board.topGameOpportunities[0].decision.state, "QUALIFIED");
  assert.equal(board.topGameOpportunities[1].decision.state, "WATCHLIST");
  assert.ok(DECISION_STATES.includes("QUALIFIED"));
});

test("movement storage advisor stays fail-closed without volume evidence", () => {
  assert.equal(recommendMovementStorage({}).recommendation, "INSUFFICIENT_EVIDENCE");
  assert.equal(
    recommendMovementStorage({ estimatedTicksPerGame: 50, gamesPerWeek: 40 })
      .recommendation,
    "KEEP_ALL_IN_D1",
  );
  assert.equal(
    recommendMovementStorage({ estimatedTicksPerGame: 800, gamesPerWeek: 60 })
      .recommendation,
    "HYBRID_D1_R2_RECOMMENDED",
  );
  assert.equal(
    recommendMovementStorage({ estimatedTicksPerGame: 8000, gamesPerWeek: 100 })
      .recommendation,
    "R2_ARCHIVE_REQUIRED",
  );
});

test("today domain board exposes movers, watchlist, and research-only props without inventing ranks", () => {
  const board = toDomainTodayBoard(
    {
      date: "2026-09-13",
      games: [
        {
          id: "cfb-1",
          sport: "cfb",
          away: { abbr: "OHIO" },
          home: { abbr: "TEX" },
          rec: { qualified: true, pick: "HOME" },
          pinSpread: -3,
          openingSpread: -1,
          sentiment: { ticketPct: 40, moneyPct: 60 },
        },
        {
          id: "nfl-1",
          sport: "nfl",
          away: { abbr: "KC" },
          home: { abbr: "BUF" },
          lean: { pick: "AWAY", reason: "EDGE_BELOW_THRESHOLD" },
          pinSpread: -7,
          openingSpread: -3,
        },
        {
          id: "mlb-1",
          sport: "mlb",
          away: { abbr: "NYY" },
          home: { abbr: "BOS" },
          playerMarkets: [
            {
              playerName: "Judge",
              team: "NYY",
              position: "OF",
              marketCanonical: "total_bases",
              line: 1.5,
              overOdds: -115,
              book: "FD",
            },
          ],
        },
      ],
    },
    { sportFilter: "all" },
  );

  assert.equal(board.topGameOpportunities.length, 2);
  assert.equal(board.topGameOpportunities[0].id, "cfb-1");
  assert.equal(board.watchlist.length, 1);
  assert.equal(board.watchlist[0].decision.state, "WATCHLIST");
  assert.ok(board.marketMovers.length >= 1);
  assert.ok(board.marketMovers[0].movement.movementMagnitude > 0);
  assert.equal(board.topPlayerProps.length, 1);
  assert.equal(board.topPlayerProps[0].surfaceStatus, "RESEARCH");
  assert.equal(board.topPlayerProps[0].decisionEligible, false);

  const cfbOnly = toDomainTodayBoard(
    {
      games: board.events.map((e) => ({
        id: e.id,
        sport: e.sport,
        away: e.teams.away,
        home: e.teams.home,
        rec: e.decision?.rec,
        lean: e.decision?.lean,
      })),
    },
    { sportFilter: "cfb" },
  );
  assert.equal(cfbOnly.events.length, 1);
  assert.equal(cfbOnly.events[0].sport, "cfb");
});
