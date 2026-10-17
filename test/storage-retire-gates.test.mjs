import test from "node:test";
import assert from "node:assert/strict";
import {
  SAFE_RETIREMENT_CANDIDATES,
  PROTECTED_UNTIL_SEPARATE_RELEASE,
  assertNotLiveMarketHistoryTarget,
  assertApplyMode,
  MARKET_HISTORY_DB,
} from "../scripts/lib/storage-retire-gates.mjs";

test("safe candidates never include 2004 CFB", () => {
  for (const c of SAFE_RETIREMENT_CANDIDATES) {
    assert.doesNotMatch(c.predicate, /2004/);
  }
  assert.ok(PROTECTED_UNTIL_SEPARATE_RELEASE.some((p) => p.id.includes("2004")));
});

test("refuse targeting live market-history shard", () => {
  assert.throws(() => assertNotLiveMarketHistoryTarget(MARKET_HISTORY_DB), /REFUSE/);
});

test("apply mode requires explicit release id", () => {
  assert.deepEqual(assertApplyMode({}), { apply: false, mode: "DRY_RUN" });
  assert.throws(() => assertApplyMode({ STORAGE_RETIRE_APPLY: "true" }), /RELEASE_ID/);
  const r = assertApplyMode({ STORAGE_RETIRE_APPLY: "true", STORAGE_RETIRE_RELEASE_ID: "release-abc12345" });
  assert.equal(r.apply, true);
});

test("RESEARCH predicate keeps CURRENT off the retire path", () => {
  const market = SAFE_RETIREMENT_CANDIDATES.find((c) => c.table === "normalized_market_observations");
  assert.match(market.predicate, /RESEARCH/);
  assert.doesNotMatch(market.predicate, /CURRENT/);
});
