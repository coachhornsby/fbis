import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIMARY_MARKET_WRITE_SOFT_LIMIT_BYTES,
  primaryMarketWriteTarget,
  streamPreferHistoryPersistence,
} from "../functions/lib/primaryCapacityWriteTarget.js";
import { bootstrapWriteTarget } from "../functions/api/polymarket-bootstrap.js";

test("primaryMarketWriteTarget prefers MARKET_HISTORY when primary is full or unknown", () => {
  const history = { prepare() { return {}; } };
  assert.equal(
    primaryMarketWriteTarget({ DB: {}, MARKET_HISTORY_DB: history }, 9_900_000_000).store,
    "MARKET_HISTORY",
  );
  assert.equal(
    primaryMarketWriteTarget({ DB: {}, MARKET_HISTORY_DB: history }, 0).store,
    "MARKET_HISTORY",
  );
  assert.equal(
    primaryMarketWriteTarget({ DB: {}, MARKET_HISTORY_DB: history }, undefined).store,
    "MARKET_HISTORY",
  );
  assert.equal(
    primaryMarketWriteTarget({ DB: {}, MARKET_HISTORY_DB: history }, 7_000_000_000).store,
    "PRIMARY",
  );
  assert.equal(
    primaryMarketWriteTarget({ DB: {} }, PRIMARY_MARKET_WRITE_SOFT_LIMIT_BYTES).blocked,
    "PRIMARY_WRITE_CAPACITY_UNAVAILABLE",
  );
});

test("streamPreferHistoryPersistence only when size is known-full", () => {
  const history = { prepare() { return {}; } };
  const env = { DB: {}, MARKET_HISTORY_DB: history };
  assert.equal(streamPreferHistoryPersistence(env, 9_900_000_000), true);
  assert.equal(streamPreferHistoryPersistence(env, PRIMARY_MARKET_WRITE_SOFT_LIMIT_BYTES), true);
  assert.equal(streamPreferHistoryPersistence(env, 7_000_000_000), false);
  assert.equal(streamPreferHistoryPersistence(env, 0), false);
  assert.equal(streamPreferHistoryPersistence(env, undefined), false);
  assert.equal(streamPreferHistoryPersistence({ DB: {} }, 9_900_000_000), false);
});

test("bootstrapWriteTarget keeps REST_WRITE_CAPACITY_UNAVAILABLE wording", () => {
  assert.equal(
    bootstrapWriteTarget({ DB: {} }, 9_900_000_000).blocked,
    "REST_WRITE_CAPACITY_UNAVAILABLE",
  );
  const history = { prepare() { return {}; } };
  assert.equal(
    bootstrapWriteTarget({ DB: {}, MARKET_HISTORY_DB: history }, 9_500_000_000).store,
    "MARKET_HISTORY",
  );
});
