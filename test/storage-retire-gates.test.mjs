import test from "node:test";
import assert from "node:assert/strict";
import {
  SAFE_RETIREMENT_CANDIDATES,
  PROTECTED_UNTIL_SEPARATE_RELEASE,
  assertNotLiveMarketHistoryTarget,
  assertApplyMode,
  assertRetentionPackageAllowsApply,
  countSql,
  deleteBatchSql,
  protectedCountSql,
  MARKET_HISTORY_DB,
  PRIMARY_DB,
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

test("unauthorized package blocks APPLY", () => {
  assert.throws(
    () =>
      assertRetentionPackageAllowsApply(
        {
          contract: "fbis-retention-release-package-v1",
          retentionReleaseAuthorized: false,
          releaseId: "release-abc12345",
          primaryDb: PRIMARY_DB,
        },
        "release-abc12345"
      ),
    /NOT_AUTHORIZED/
  );
});

test("authorized package requires matching release id", () => {
  assert.throws(
    () =>
      assertRetentionPackageAllowsApply(
        {
          contract: "fbis-retention-release-package-v1",
          retentionReleaseAuthorized: true,
          releaseId: "release-abc12345",
          primaryDb: PRIMARY_DB,
        },
        "release-OTHER999"
      ),
    /RELEASE_ID_MISMATCH/
  );
  assert.equal(
    assertRetentionPackageAllowsApply(
      {
        contract: "fbis-retention-release-package-v1",
        retentionReleaseAuthorized: true,
        releaseId: "release-abc12345",
        primaryDb: PRIMARY_DB,
      },
      "release-abc12345"
    ),
    true
  );
});

test("count and delete SQL stay on frozen candidates", () => {
  const sql = countSql("market-research-frozen-20261017");
  assert.match(sql, /RESEARCH/);
  assert.match(sql, /667201/);
  const del = deleteBatchSql("cfb-roster-obs-2005-2025", 100);
  assert.match(del, /^DELETE FROM cfb_roster_observations/);
  assert.match(del, /2005 AND 2025/);
  assert.match(del, /LIMIT 100/);
  assert.throws(() => countSql("not-a-cohort"), /UNKNOWN_CANDIDATE/);
  assert.throws(() => deleteBatchSql("market-research-frozen-20261017", 9999), /INVALID_BATCH_LIMIT/);
  assert.match(protectedCountSql("cfb-roster-2004"), /season = 2004/);
});
