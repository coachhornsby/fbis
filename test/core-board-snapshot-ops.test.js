import test from "node:test";
import assert from "node:assert/strict";
import {
  CORE_BOARD_SUMMARY_MAX_AGE_MS,
  evaluateCorePublishResult,
  evaluateCoreFreshnessResult,
  evaluateCoreSnapshotOpsCycle,
} from "../scripts/lib/coreBoardSnapshotOps.mjs";

const sports = Array.from({ length: 11 }, (_, i) => ({
  sport: ["nfl", "cfb", "cbb", "nba", "wnba", "mlb", "nhl", "soccer", "tennis", "npb", "kbo"][i],
  complete: true,
  gameCount: i === 2 ? 0 : 10,
  projectionCount: i === 2 ? 0 : 10,
  authority: "PRIMARY",
}));

test("publish evaluation accepts complete CORE snapshot and rejects wager authority", () => {
  const ok = evaluateCorePublishResult({
    ok: true,
    canAuthorizeWager: false,
    summary: {
      complete: true,
      asOf: "2026-10-20T12:00:00.000Z",
      sourceBinding: "CORE_DB",
      sports,
      incompleteSports: [],
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.sportCount, 11);

  const bad = evaluateCorePublishResult({
    ok: true,
    canAuthorizeWager: true,
    summary: { complete: true, asOf: "2026-10-20T12:00:00.000Z", sports, incompleteSports: [] },
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.includes("WAGER_AUTHORITY_MUST_STAY_FALSE"));
});

test("freshness evaluation enforces 15-minute SLA", () => {
  const now = new Date("2026-10-20T12:10:00.000Z");
  const fresh = evaluateCoreFreshnessResult(
    {
      ok: true,
      usable: true,
      asOf: "2026-10-20T12:05:00.000Z",
      canAuthorizeWager: false,
      freshness: { fresh: true, reason: "WITHIN_SLA", ageMs: 5 * 60 * 1000, maxAgeMs: CORE_BOARD_SUMMARY_MAX_AGE_MS },
    },
    { now }
  );
  assert.equal(fresh.ok, true);
  assert.equal(fresh.ageMs, 5 * 60 * 1000);

  const stale = evaluateCoreFreshnessResult(
    {
      ok: false,
      reason: "SUMMARY_STALE",
      asOf: "2026-10-20T11:50:00.000Z",
      canAuthorizeWager: false,
    },
    { now }
  );
  assert.equal(stale.ok, false);
  assert.ok(stale.failures.includes("SUMMARY_STALE"));
});

test("ops cycle fails closed when either publish or freshness fails", () => {
  const now = new Date("2026-10-20T12:10:00.000Z");
  const cycle = evaluateCoreSnapshotOpsCycle({
    publish: {
      ok: true,
      canAuthorizeWager: false,
      summary: {
        complete: true,
        asOf: "2026-10-20T12:09:00.000Z",
        sourceBinding: "CORE_DB",
        sports,
        incompleteSports: [],
      },
    },
    freshness: {
      ok: true,
      usable: true,
      asOf: "2026-10-20T12:09:00.000Z",
      canAuthorizeWager: false,
    },
    now,
  });
  assert.equal(cycle.ok, true);

  const broken = evaluateCoreSnapshotOpsCycle({
    publish: { ok: false, reason: "CORE_UNBOUND", canAuthorizeWager: false },
    freshness: { ok: false, reason: "SUMMARY_MISSING", canAuthorizeWager: false },
    now,
  });
  assert.equal(broken.ok, false);
  assert.ok(broken.failures.length >= 2);
});
