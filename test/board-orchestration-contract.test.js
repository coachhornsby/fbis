import test from "node:test";
import assert from "node:assert/strict";
import { deriveDecisionState, toDomainEvent, toDomainTodayBoard } from "../functions/lib/fbisDomain.js";
import { isGameOnBoardDate } from "../functions/lib/todayBoard.js";

test("qualified rec cannot survive without a comparable operational market", () => {
  const state = deriveDecisionState({
    projectionUnavailable: false,
    marketUnavailable: true,
    marketComparable: false,
    rec: { qualified: true, pick: "HOME" },
  });
  assert.equal(state.state, "PASS");
  assert.ok(state.reasonCodes.includes("OPERATIONAL_MARKET_UNAVAILABLE"));
});

test("domain event uses canonical comparison market instead of Pinnacle compatibility fields", () => {
  const event = toDomainEvent({
    id: "g1",
    sport: "mlb",
    projMargin: -3.7,
    projTotal: 8.3,
    projectionUnavailable: false,
    marketUnavailable: false,
    marketComparable: true,
    pinSpread: 0,
    market: {
      comparisonMarketRole: "CONSENSUS_MARKET",
      comparisonSource: "ACTION",
      comparisonTimestamp: "2026-09-16T20:00:00.000Z",
      comparison: { spread: 1.5, total: 8.5, moneyline: null, book: "ACTION" },
    },
    rec: { qualified: true, pick: "LAD", market: "SPREAD" },
    away: { abbr: "LAD" },
    home: { abbr: "CIN" },
  });
  const spread = event.consensusMarkets.find((m) => m.marketType === "spread");
  assert.equal(spread.line, 1.5);
  assert.equal(spread.provider, "ACTION");
  assert.equal(event.modelVsMarket.sideDifference, 2.2);
  assert.equal(event.decision.state, "QUALIFIED");
});

test("missing ACTION splits remain unavailable, never 0/0", () => {
  const event = toDomainEvent({
    id: "g2",
    sport: "mlb",
    projMargin: 1,
    projectionUnavailable: false,
    marketUnavailable: false,
    marketComparable: true,
    market: {
      comparisonMarketRole: "CONSENSUS_MARKET",
      comparisonSource: "ACTION",
      comparison: { spread: -1.5, total: 8, moneyline: null, book: "ACTION" },
    },
  });
  assert.equal(event.publicSplits.ticketPct, null);
  assert.equal(event.publicSplits.moneyPct, null);
  assert.equal(event.publicSplits.available, false);
  assert.equal(event.publicSplits.source, null);
});

test("TODAY date boundary is America/Chicago strict", () => {
  assert.equal(isGameOnBoardDate({ start: "2026-09-17T01:30:00.000Z" }, "2026-09-16"), true);
  assert.equal(isGameOnBoardDate({ start: "2026-09-17T17:10:00.000Z" }, "2026-09-16"), false);
});

test("domain counts come from the same scoped decision records", () => {
  const market = { comparisonMarketRole: "CONSENSUS_MARKET", comparisonSource: "ACTION", comparison: { spread: -1.5, total: 8.5, moneyline: null, book: "ACTION" } };
  const board = toDomainTodayBoard({
    date: "2026-09-16",
    counts: { qualified: 99 },
    games: [
      { id: "1", sport: "mlb", projMargin: 2, projectionUnavailable: false, marketUnavailable: false, marketComparable: true, market, rec: { qualified: true } },
      { id: "2", sport: "mlb", projMargin: 1, projectionUnavailable: false, marketUnavailable: true, marketComparable: false, rec: { qualified: true } },
    ],
  }, { sportFilter: "mlb" });
  assert.equal(board.counts.qualified, 1);
  assert.equal(board.counts.games, 2);
  assert.equal(board.topGameOpportunities.length, 1);
});
