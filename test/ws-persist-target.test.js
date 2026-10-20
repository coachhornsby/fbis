import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIMARY_WS_SOFT_CAP_BYTES,
  resolveWsPersistTarget,
} from "../services/polymarket-us-stream/wsPersistTarget.mjs";

test("WS persist defaults to Q4 when bound", () => {
  const q4 = { prepare() { return {}; } };
  const legacy = { prepare() { return {}; } };
  const target = resolveWsPersistTarget({
    MARKET_HISTORY_2026Q4_DB: q4,
    MARKET_HISTORY_DB: legacy,
  }, 1_000_000_000);
  assert.equal(target.store, "MARKET_HISTORY_2026Q4");
  assert.equal(target.reason, "WS_Q4_DEFAULT");
  assert.equal(target.preferHistory, true);
  assert.equal(target.blocked, false);
});

test("WS persist fails closed when Q4 unbound (no silent legacy fallback)", () => {
  const legacy = { prepare() { return {}; } };
  const target = resolveWsPersistTarget({ MARKET_HISTORY_DB: legacy }, 1_000_000_000);
  assert.equal(target.store, null);
  assert.equal(target.blocked, true);
  assert.match(target.reason, /Q4_UNBOUND_FAIL_CLOSED/);
});

test("WS persist allows legacy only with explicit escape hatch", () => {
  const legacy = { prepare() { return {}; } };
  const target = resolveWsPersistTarget({
    MARKET_HISTORY_DB: legacy,
    MARKET_HISTORY_ALLOW_LEGACY_WRITE: "enabled",
  }, 1_000_000_000);
  assert.equal(target.store, "MARKET_HISTORY");
  assert.equal(target.preferHistory, true);
});

test("opt-in primary-first soft-caps at 8GB into Q4", () => {
  const q4 = { prepare() { return {}; } };
  const env = { MARKET_HISTORY_2026Q4_DB: q4, STREAM_WS_PERSIST_PRIMARY: "enabled" };
  assert.equal(resolveWsPersistTarget(env, 7_000_000_000).store, "PRIMARY");
  assert.equal(resolveWsPersistTarget(env, PRIMARY_WS_SOFT_CAP_BYTES).store, "MARKET_HISTORY_2026Q4");
  assert.equal(resolveWsPersistTarget(env, 8_500_000_000).reason, "PRIMARY_SOFT_CAP_HISTORY_ROUTE");
});
