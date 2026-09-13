import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_NAV,
  CUSTOMER_NAV,
  SPORT_FILTERS,
  formatShellDate,
  legacyToRoute,
  routeToLegacy,
} from "../src/app/navigation.js";

describe("FBIS product navigation", () => {
  it("exposes customer nav without sports as primary tabs", () => {
    const ids = CUSTOMER_NAV.map((x) => x.id);
    assert.deepEqual(ids, [
      "today",
      "markets",
      "player-props",
      "bets",
      "performance",
      "research",
    ]);
    assert.ok(!ids.includes("mlb"));
    assert.ok(!ids.includes("cfb"));
    assert.equal(ADMIN_NAV.length, 1);
    assert.equal(ADMIN_NAV[0].id, "system");
  });

  it("keeps sports as filters only", () => {
    const ids = SPORT_FILTERS.map((x) => x.id);
    assert.ok(ids.includes("all"));
    assert.ok(ids.includes("cfb"));
    assert.ok(ids.includes("nfl"));
    assert.ok(ids.includes("mlb"));
  });

  it("maps legacy tabs to product routes", () => {
    assert.equal(legacyToRoute({ tab: "sys" }).route, "system");
    assert.equal(legacyToRoute({ tab: "board", sport: "cfb" }).route, "markets");
    assert.equal(legacyToRoute({ tab: "board", sport: "cfb" }).sportFilter, "cfb");
    assert.equal(legacyToRoute({ tab: "today" }).route, "today");
    assert.equal(legacyToRoute({ tab: "bets" }).route, "bets");
  });

  it("maps product routes back to legacy loaders", () => {
    assert.equal(routeToLegacy("system").tab, "sys");
    assert.equal(routeToLegacy("markets", "nfl").tab, "board");
    assert.equal(routeToLegacy("markets", "nfl").sport, "nfl");
    assert.equal(routeToLegacy("player-props").tab, "today");
    assert.equal(routeToLegacy("performance").tab, "today");
    assert.equal(routeToLegacy("research").tab, "today");
  });

  it("formats shell date in Chicago timezone", () => {
    const label = formatShellDate(new Date("2026-09-12T18:00:00Z"));
    assert.match(label, /SEP/);
    assert.match(label, /12/);
  });
});
