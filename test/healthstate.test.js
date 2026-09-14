import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveHealthState, writeVerificationState } from "../functions/lib/healthContract.js";
import { deriveViewState, deriveGlobalState, badgeLabel } from "../src/lib/healthState.js";

describe("shared health-state contract", () => {
  it("distinguishes healthy, degraded, unavailable, stale", () => {
    const healthy = deriveHealthState({
      hasAuthoritativeData: true,
      requiredChecks: [{ name: "d1-read", ok: true }],
    });
    assert.equal(healthy.state, "HEALTHY");
    const degraded = deriveHealthState({
      hasAuthoritativeData: true,
      requiredChecks: [{ name: "d1-read", ok: false }],
    });
    assert.equal(degraded.state, "DEGRADED");
    const unavailable = deriveHealthState({
      hasAuthoritativeData: false,
      requiredChecks: [{ name: "d1-read", ok: false }],
    });
    assert.equal(unavailable.state, "UNAVAILABLE");
    const stale = deriveHealthState({
      hasAuthoritativeData: true,
      usingLastKnownGood: true,
      requiredChecks: [{ name: "d1-read", ok: false }],
    });
    assert.equal(stale.state, "STALE");
  });

  it("fails required checks when their success timestamp is stale", () => {
    const now = Date.parse("2026-09-09T12:00:00Z");
    const out = deriveHealthState({
      now,
      hasAuthoritativeData: true,
      requiredChecks: [
        {
          name: "scheduled-harvest",
          ok: true,
          detail: "healthy",
          lastSuccessAt: "2026-09-08T12:00:00Z",
          freshnessMs: 8 * 60 * 60 * 1000,
        },
      ],
    });
    assert.equal(out.state, "DEGRADED");
    assert.equal(out.checks[0].ok, false);
    assert.equal(out.checks[0].stale, true);
    assert.equal(out.failures.length, 1);
    assert.equal(out.failures[0].name, "scheduled-harvest");
  });

  it("frontend global state never reports LIVE on unavailable tab state", () => {
    const today = deriveViewState({ apiState: "UNAVAILABLE", error: "boom", stale: false, hasData: false });
    const global = deriveGlobalState({
      activeTab: "today",
      pipelineState: "HEALTHY",
      todayState: today,
      betsState: "HEALTHY",
      sysState: "HEALTHY",
      boardState: "HEALTHY",
    });
    assert.equal(global, "UNAVAILABLE");
  });

  it("HEALTHY + cached/fallback board source is CACHED not LIVE", () => {
    assert.equal(badgeLabel("HEALTHY"), "LIVE");
    assert.equal(
      badgeLabel("HEALTHY", { liveCollectionHealthy: false, boardSourceMode: "CACHED_PROVIDER" }),
      "CACHED",
    );
    assert.equal(badgeLabel("HEALTHY", { boardSourceMode: "LIVE_PROVIDER" }), "LIVE");
    assert.equal(badgeLabel("DEGRADED", { liveCollectionHealthy: false }), "DEGRADED");
  });

  it("classifies write verification states", () => {
    assert.equal(
      writeVerificationState({
        readOk: true,
        lastWriteSuccessAt: "2026-09-01T00:00:00Z",
        lastReadbackSuccessAt: "2026-09-01T00:00:05Z",
        failedWrites: 0,
      }),
      "VERIFIED"
    );
    assert.equal(writeVerificationState({ readOk: false, lastWriteSuccessAt: null, failedWrites: 0 }), "UNVERIFIED");
    assert.equal(writeVerificationState({ readOk: true, lastWriteSuccessAt: null, failedWrites: 2 }), "FAILED");
    assert.equal(writeVerificationState({ readOk: false, lastWriteSuccessAt: null, failedWrites: 0, reason: "quota exceeded" }), "BLOCKED");
  });

  it("does not let historical failures override newer successful write/readback", () => {
    const state = writeVerificationState({
      readOk: true,
      lastWriteSuccessAt: "2026-09-02T12:00:00Z",
      lastReadbackSuccessAt: "2026-09-02T12:00:03Z",
      lastFailureAt: "2026-09-01T12:00:00Z",
      failedWrites: 9,
    });
    assert.equal(state, "VERIFIED");
  });
});
