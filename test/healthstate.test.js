import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveHealthState } from "../functions/lib/healthContract.js";
import { deriveViewState, deriveGlobalState } from "../src/lib/healthState.js";

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
});
