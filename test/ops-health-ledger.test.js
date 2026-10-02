import test from "node:test";
import assert from "node:assert/strict";
import { deriveFreshnessState } from "../functions/lib/opsHealthLedger.js";

test("ops freshness uses per-component thresholds", () => {
  const component = {
    grace_period_minutes: 10,
    stale_after_minutes: 30,
    escalation_after_minutes: 60,
  };
  const base = Date.parse("2026-10-01T12:00:00Z");
  assert.equal(
    deriveFreshnessState(component, { source_freshness_at: "2026-10-01T11:55:00Z" }, base).severity,
    "INFO"
  );
  assert.equal(
    deriveFreshnessState(component, { source_freshness_at: "2026-10-01T11:45:00Z" }, base).severity,
    "WARN"
  );
  assert.equal(
    deriveFreshnessState(component, { source_freshness_at: "2026-10-01T11:20:00Z" }, base).severity,
    "DEGRADED"
  );
  assert.equal(
    deriveFreshnessState(component, { source_freshness_at: "2026-10-01T10:30:00Z" }, base).severity,
    "CRITICAL"
  );
});

test("ops freshness separates layered freshness and uses newest verified layer", () => {
  const component = { grace_period_minutes: 15, stale_after_minutes: 45, escalation_after_minutes: 90 };
  const out = deriveFreshnessState(
    component,
    {
      workflow_freshness_at: "2026-10-01T10:00:00Z",
      source_freshness_at: "2026-10-01T10:30:00Z",
      database_freshness_at: "2026-10-01T10:40:00Z",
      published_freshness_at: "2026-10-01T10:50:00Z",
    },
    Date.parse("2026-10-01T11:00:00Z")
  );
  assert.equal(out.latestAt, "2026-10-01T10:50:00.000Z");
  assert.equal(out.state, "HEALTHY");
});
