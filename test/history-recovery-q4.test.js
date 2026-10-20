import test from "node:test";
import assert from "node:assert/strict";
import { resolveRecoveryHistoryDb } from "../services/polymarket-us-stream/historyRecovery.mjs";

test("stream recovery prefers Q4 and fails closed without escape hatch", () => {
  const q4 = { prepare() { return {}; } };
  const legacy = { prepare() { return {}; } };
  assert.equal(resolveRecoveryHistoryDb({ MARKET_HISTORY_2026Q4_DB: q4, MARKET_HISTORY_DB: legacy }).target, "MARKET_HISTORY_2026Q4_DB");
  const blocked = resolveRecoveryHistoryDb({ MARKET_HISTORY_DB: legacy });
  assert.equal(blocked.db, null);
  assert.match(blocked.reason, /Q4_UNBOUND_FAIL_CLOSED/);
  assert.equal(
    resolveRecoveryHistoryDb({
      MARKET_HISTORY_DB: legacy,
      MARKET_HISTORY_ALLOW_LEGACY_WRITE: "enabled",
    }).target,
    "MARKET_HISTORY_DB"
  );
});
