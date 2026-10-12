import test from "node:test";
import assert from "node:assert/strict";
import { mergeVerifiedSportBoards } from "../src/lib/mergeVerifiedSportBoards.js";

const oldGame = (sport, id) => ({
  id, sport, status: "unverified", durableFallback: { source: "d1" },
  projHome: 2, projAway: 1, marketAvailable: false, rec: null, lean: null,
});
const focusedGame = (sport, id) => ({
  id, sport, status: "scheduled", durableFallback: null, start: "2026-10-12T19:00:00Z",
  projHome: 4, projAway: 3, marketAvailable: true, rec: null, lean: null,
  market: { source: "pinnacle", reference: { homeMl: -110 } },
});
const base = () => ({
  date: "2026-10-12",
  groups: [
    { sport: "nfl", n: 1, games: [oldGame("nfl", "n1")] },
    { sport: "nhl", n: 1, games: [oldGame("nhl", "h1")] },
  ],
  games: [oldGame("nfl", "n1"), oldGame("nhl", "h1")],
  counts: { games: 2, bySport: { nfl: 1, nhl: 1 }, durableFallbackGames: 2, qualified: 0 },
  health: {
    state: "DEGRADED", boardDeliveryMode: "D1_UNVERIFIED_MATCHUPS",
    checks: [{ name: "nfl-market", ok: false, required: true }],
    sourceStatus: { statuses: { nfl: { markets: "unavailable" } },
      requiredChecks: [{ name: "nfl-market", ok: false }] },
  },
  coverage: { qualificationAuthoritative: false },
  feeds: { nfl: { source: "D1_SCHEDULE_PRESTART_SNAPSHOT" } },
});
const focused = (sport, games = [focusedGame(sport, sport + "-1")]) => ({
  date: "2026-10-12", groups: [{ sport, n: games.length, games }], games,
  feeds: { [sport]: { ok: true, source: "RESEARCH_SLATE_WITH_DURABLE_RECOVERY" } },
  health: { state: "HEALTHY", boardDeliveryMode: "RESEARCH_FEEDS",
    checks: [{ name: sport + "-market", ok: true, required: true }],
    sourceStatus: { statuses: { [sport]: { markets: "ok" } },
      requiredChecks: [{ name: sport + "-market", ok: true }] } },
});

test("all-sports cards recover genuine focused markets without altering other games", () => {
  const b = base(), f = focused("nfl");
  const restored = mergeVerifiedSportBoards(b, [{ sport: "nfl", board: f }]);
  assert.equal(restored.games.length, 2);
  assert.equal(restored.counts.durableFallbackGames, 1);
  assert.equal(restored.health.marketsAvailable, 1);
  assert.equal(restored.health.boardDeliveryMode, "FOCUSED_FEEDS_WITH_DURABLE_FALLBACK");
  assert.equal(restored.health.state, "DEGRADED");
  assert.equal(restored.games.find(g => g.sport === "nfl").market, f.games[0].market);
  assert.equal(restored.games.find(g => g.sport === "nhl").qualificationBlocked, undefined);
  assert.equal(restored.games.find(g => g.sport === "nhl").marketAvailable, false);
  assert.equal(restored.health.sourceStatus.statuses.nfl.markets, "ok");
  assert.equal(restored.health.failures.length, 0);
  assert.equal(restored.coverage.qualificationAuthoritative, false);
  assert.equal(b.games[0].marketAvailable, false);
});

test("does not substitute failed, date-mismatched or unverified focused responses", () => {
  const b = base();
  const bad = focused("nfl");
  bad.date = "2026-10-13";
  assert.equal(mergeVerifiedSportBoards(b, [{ sport: "nfl", board: bad }]), b);
  const fallback = focused("nfl");
  fallback.health.boardDeliveryMode = "D1_UNVERIFIED_MATCHUPS";
  assert.equal(mergeVerifiedSportBoards(b, [{ sport: "nfl", board: fallback }]), b);
  const mixed = focused("nfl");
  mixed.games[0].sport = "nba";
  assert.equal(mergeVerifiedSportBoards(b, [{ sport: "nfl", board: mixed }]), b);
  const failed = focused("nfl");
  failed.feeds.nfl.ok = false;
  assert.equal(mergeVerifiedSportBoards(b, [{ sport: "nfl", board: failed }]), b);
});

test("never fabricates qualification when no focused sport returned authoritative output", () => {
  const b = base();
  const restored = mergeVerifiedSportBoards(b, [{ sport: "nfl", board: focused("nfl", []) }]);
  assert.equal(restored, b);
  assert.equal(restored.counts.qualified, 0);
  assert.equal(restored.games[0].rec, null);
});
