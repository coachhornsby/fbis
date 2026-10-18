import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIMARY_WS_SOFT_CAP_BYTES,
  resolveWsPersistTarget,
} from "../services/polymarket-us-stream/wsPersistTarget.mjs";

test("WS persist defaults to MARKET_HISTORY when history binding exists", () => {
  const history = { prepare() { return {}; } };
  const target = resolveWsPersistTarget({ MARKET_HISTORY_DB: history }, 1_000_000_000);
  assert.equal(target.store, "MARKET_HISTORY");
  assert.equal(target.reason, "WS_HISTORY_DEFAULT");
  assert.equal(target.preferHistory, true);
});

test("WS persist falls back to primary when history binding is missing", () => {
  const target = resolveWsPersistTarget({ DB: {} }, 9_900_000_000);
  assert.equal(target.store, "PRIMARY");
  assert.equal(target.preferHistory, false);
});

test("opt-in primary-first soft-caps at 8GB into history", () => {
  const history = { prepare() { return {}; } };
  const env = { MARKET_HISTORY_DB: history, STREAM_WS_PERSIST_PRIMARY: "enabled" };
  assert.equal(resolveWsPersistTarget(env, 7_000_000_000).store, "PRIMARY");
  assert.equal(resolveWsPersistTarget(env, PRIMARY_WS_SOFT_CAP_BYTES).store, "MARKET_HISTORY");
  assert.equal(resolveWsPersistTarget(env, 8_500_000_000).reason, "PRIMARY_SOFT_CAP_HISTORY_ROUTE");
});
