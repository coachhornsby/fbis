import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_NAV,
  CUSTOMER_NAV,
  SPORT_FILTERS,
  formatShellDate,
  legacyToRoute,
  normalizeRoute,
  routeToLegacy,
} from "../src/app/navigation.js";

describe("FBIS Board-first product navigation", () => {
  it("exposes Board-first customer nav without sports as primary tabs", () => {
    const ids = CUSTOMER_NAV.map((x) => x.id);
    assert.deepEqual(ids, ["board", "models", "model-lab", "bets", "market"]);
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

  it("maps legacy tabs to Board-first routes", () => {
    assert.equal(legacyToRoute({ tab: "sys" }).route, "system");
    assert.equal(legacyToRoute({ tab: "board", sport: "cfb" }).route, "market");
    assert.equal(legacyToRoute({ tab: "board", sport: "cfb" }).sportFilter, "cfb");
    assert.equal(legacyToRoute({ tab: "today" }).route, "board");
    assert.equal(legacyToRoute({ tab: "bets" }).route, "bets");
  });

  it("normalizes legacy route ids", () => {
    assert.equal(normalizeRoute("today"), "board");
    assert.equal(normalizeRoute("markets"), "market");
    assert.equal(normalizeRoute("research"), "model-lab");
    assert.equal(normalizeRoute("player-props"), "models");
    assert.equal(normalizeRoute("board"), "board");
  });

  it("maps product routes back to legacy loaders", () => {
    assert.equal(routeToLegacy("system").tab, "sys");
    assert.equal(routeToLegacy("market", "nfl").tab, "board");
    assert.equal(routeToLegacy("market", "nfl").sport, "nfl");
    assert.equal(routeToLegacy("board").tab, "today");
    assert.equal(routeToLegacy("models").tab, "today");
    assert.equal(routeToLegacy("model-lab").tab, "today");
  });

  it("formats shell date in Chicago timezone", () => {
    const label = formatShellDate(new Date("2026-09-12T18:00:00Z"));
    assert.match(label, /SEP/);
    assert.match(label, /12/);
  });
});
