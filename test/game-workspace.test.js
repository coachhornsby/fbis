import test from "node:test";
import assert from "node:assert/strict";
import { buildGameWorkspaceView } from "../src/features/game/buildGameWorkspaceView.js";

test("game workspace view maps board game into domain event without inventing decision authority", () => {
  const view = buildGameWorkspaceView({
    id: "cfb-1",
    sport: "cfb",
    sportLabel: "CFB",
    startCt: "2:30 PM",
    status: "scheduled",
    away: { name: "Ohio State", abbr: "OHIO" },
    home: { name: "Texas", abbr: "TEX" },
    projAway: 24.1,
    projHome: 27.4,
    projTotal: 51.5,
    projMargin: 3.3,
    pinSpread: -2.5,
    pinSpreadHomePrice: -110,
    openingSpread: -1.5,
    bestSpread: -2.5,
    bestSpreadPrice: -105,
    bestBook: "draftkings",
    bookCount: 5,
    sentiment: { ticketPct: 41, moneyPct: 63, magnitude: 1, direction: "home" },
    rec: { qualified: true, pick: "HOME", market: "spread" },
    weather: { temperature: 86, windSpeed: 7, description: "Clear" },
    modelVersion: "CFB-FBIS-v2",
  });

  assert.equal(view.event.id, "cfb-1");
  assert.equal(view.event.decision.state, "QUALIFIED");
  assert.equal(view.event.decision.authorized, false);
  assert.equal(view.event.model.projMargin, 3.3);
  assert.ok(view.event.consensusMarkets.some((m) => m.marketType === "spread"));
  assert.equal(view.event.movement.bestBook, "draftkings");
  assert.equal(view.event.movement.movementMagnitude, 1);
  assert.equal(view.weather.temperature, 86);
  assert.equal(view.lab.sport, "cfb");
});

test("game workspace view stays empty-safe for null/invalid board games", () => {
  assert.equal(buildGameWorkspaceView(null).event, null);
  assert.equal(buildGameWorkspaceView(undefined).event, null);
  const empty = buildGameWorkspaceView({});
  assert.equal(empty.event.decision.state, "RESEARCH");
  assert.equal(empty.event.decision.authorized, false);
  assert.equal(empty.event.consensusMarkets.length, 0);
});

test("watchlist board games surface WATCHLIST without authorizing", () => {
  const view = buildGameWorkspaceView({
    id: "nfl-1",
    sport: "nfl",
    away: { abbr: "KC" },
    home: { abbr: "BUF" },
    lean: { pick: "AWAY", reason: "EDGE_BELOW_THRESHOLD" },
    pinSpread: -3.5,
    openingSpread: -1.5,
  });
  assert.equal(view.event.decision.state, "WATCHLIST");
  assert.equal(view.event.decision.qualified, false);
  assert.equal(view.event.decision.authorized, false);
  assert.ok(view.event.decision.reasonCodes.includes("EDGE_BELOW_THRESHOLD"));
});
