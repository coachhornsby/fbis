import test from "node:test";
import assert from "node:assert/strict";
import { deriveFreshnessState, evaluateManifestInvariants } from "../functions/lib/opsHealthLedger.js";

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


test("manifest invariants reject green zero-persist and partial accounting", () => {
  const checks = evaluateManifestInvariants({
    status: "success",
    expected_items: 10,
    received_items: 10,
    persisted_items: 0,
    rejected_items: 0,
    visible_items: 0,
  });
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
  assert.equal(byKey["expected-received"].ok, true);
  assert.equal(byKey["received-persisted"].ok, false);
  assert.equal(byKey["success-nonempty"].ok, false);
});

test("manifest invariants pass a fully reconciled run", () => {
  const checks = evaluateManifestInvariants({
    status: "success",
    expected_items: 10,
    received_items: 10,
    persisted_items: 9,
    rejected_items: 1,
    visible_items: 9,
  });
  assert.equal(checks.every((c) => c.ok), true);
});
