import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveActionDailyStatus } from "../functions/api/action-daily-status.js";

describe("ACTION daily status contract", () => {
  const now = Date.parse("2026-09-20T13:30:00Z");

  it("is healthy only after a successful run has persisted observations", () => {
    const out = deriveActionDailyStatus({
      run: { status: "success_daily", started_at: "2026-09-20T12:00:00Z" },
      persistedObservations: 12,
      now,
    });
    assert.equal(out.state, "HEALTHY");
    assert.equal(out.healthy, true);
    assert.equal(out.verifiedPersisted, true);
  });

  it("keeps a completed one-run-per-day snapshot healthy when the live slate gains a late game", () => {
    const out = deriveActionDailyStatus({
      run: { status: "success_daily", started_at: "2026-09-20T12:00:00Z" },
      persistedObservations: 84,
      expectedSlateGames: 17,
      coveredSlateGames: 16,
      verificationExpectedSlateGames: 16,
      verificationCoveredSlateGames: 16,
      now,
    });
    assert.equal(out.state, "HEALTHY");
    assert.equal(out.verifiedSlateCoverage, true);
    assert.equal(out.currentSlateFullyCovered, false);
    assert.equal(out.lateSlateDriftGames, 1);
    assert.equal(out.reason, "daily_run_verified_with_late_slate_drift");
  });

  it("degrades a successful actor run with zero persisted observations", () => {
    const out = deriveActionDailyStatus({
      run: { status: "success_daily", started_at: "2026-09-20T12:00:00Z" },
      persistedObservations: 0,
      now,
    });
    assert.equal(out.state, "DEGRADED");
    assert.equal(out.healthy, false);
    assert.equal(out.verifiedPersisted, false);
    assert.equal(out.reason, "success_without_persisted_observations");
  });

  it("distinguishes active from stale running jobs", () => {
    const active = deriveActionDailyStatus({
      run: { status: "running_daily", started_at: "2026-09-20T13:15:00Z" },
      now,
    });
    assert.equal(active.state, "RUNNING");

    const stale = deriveActionDailyStatus({
      run: { status: "running_daily", started_at: "2026-09-20T12:00:00Z" },
      now,
    });
    assert.equal(stale.state, "STALE");
  });

  it("surfaces terminal failure", () => {
    const out = deriveActionDailyStatus({
      run: {
        status: "failed_daily",
        started_at: "2026-09-20T12:00:00Z",
        error_class: "daily_actor_failure",
      },
      now,
    });
    assert.equal(out.state, "FAILED");
    assert.equal(out.reason, "daily_actor_failure");
  });

  it("reports a missing daily run explicitly", () => {
    const out = deriveActionDailyStatus({ run: null, persistedObservations: 0, now });
    assert.equal(out.state, "MISSING");
    assert.equal(out.reason, "no_daily_run_today");
  });
});
