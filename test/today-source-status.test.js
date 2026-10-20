import test from "node:test";
import assert from "node:assert/strict";
import { buildTodaySourceStatus, gameHasResearchMarketDelivery } from "../functions/api/today.js";

test("research market delivery detects pin captures and exchange venue offers", () => {
  assert.equal(gameHasResearchMarketDelivery({}), false);
  assert.equal(gameHasResearchMarketDelivery({ pinnoddsResearch: { offers: [{ source: "PinnOdds" }] } }), true);
  assert.equal(gameHasResearchMarketDelivery({ market: { venueOffers: [{ source: "Polymarket US" }] } }), true);
});

test("sport market check stays healthy for research-only delivery without EXEC MKT", () => {
  const board = {
    feeds: { nhl: { ok: true, sources: {} } },
    games: [
      {
        sport: "nhl",
        id: "401",
        marketUnavailable: true,
        projectionUnavailable: false,
        pinnoddsResearch: { offers: [{ source: "PinnOdds", marketFamily: "moneyline" }] },
        market: {
          venueOffers: [{ source: "Polymarket US WebSocket", deliveryStore: "MARKET_HISTORY_2026Q4_DB" }],
        },
      },
    ],
  };
  const status = buildTodaySourceStatus(board);
  assert.equal(status.statuses.nhl.markets, "research-only");
  assert.equal(status.statuses.nhl.usableMarkets, 0);
  assert.equal(status.statuses.nhl.researchMarkets, 1);
  assert.equal(status.statuses.nhl.pinnoddsCaptures, 1);
  assert.equal(status.statuses.nhl.exchangeOffers, 1);
  const marketCheck = status.requiredChecks.find((c) => c.name === "nhl-market");
  assert.equal(marketCheck.ok, true);
  assert.match(marketCheck.detail, /research=1/);
});

test("sport market check fails only when games exist with no research and no exec markets", () => {
  const board = {
    feeds: { nhl: { ok: true, sources: {} } },
    games: [{ sport: "nhl", id: "401", marketUnavailable: true, projectionUnavailable: false }],
  };
  const status = buildTodaySourceStatus(board);
  assert.equal(status.statuses.nhl.markets, "unavailable");
  assert.equal(status.requiredChecks.find((c) => c.name === "nhl-market").ok, false);
});

test("empty slate remains healthy no-games without inventing market coverage", () => {
  const board = { feeds: { mlb: { ok: true, sources: {} } }, games: [] };
  const status = buildTodaySourceStatus(board);
  assert.equal(status.statuses.mlb.markets, "no-games");
  assert.equal(status.requiredChecks.find((c) => c.name === "mlb-market").ok, true);
});
