import test from "node:test";
import assert from "node:assert/strict";
import { archiveProgressFailures } from "../scripts/lib/market-history-archive-ops-evaluate.mjs";

test("held lease fails with explicit reason, not missing column schema", () => {
  const failures = archiveProgressFailures({
    ok: true, reason: "ARCHIVE_LEASE_HELD", lease: { acquired: false, holder: "cron", expiresAt: "2026-10-26T08:00:00Z" },
    archived: 0, scanned: 0, moreRemaining: true,
  }, { writes: true });
  assert.deepEqual(failures, ["ARCHIVE_LEASE_HELD", "ARCHIVE_NO_PROGRESS_BACKLOG_REMAINS"]);
});
test("verified 50-column progress is valid even with more backlog", () => {
  assert.deepEqual(archiveProgressFailures({ ok: true, columnCount: 50, archived: 99, moreRemaining: true }, { writes: true }), []);
});
test("real missing columns remain a hard failure", () => {
  assert.deepEqual(archiveProgressFailures({ ok: true, columnCount: 49, archived: 1, moreRemaining: false }, { writes: true }), ["COLUMN_COUNT_49_EXPECTED_50"]);
});
test("zero progress with remaining backlog cannot pass green", () => {
  assert.deepEqual(archiveProgressFailures({ ok: true, columnCount: 50, archived: 0, moreRemaining: true }, { writes: true }), ["ARCHIVE_NO_PROGRESS_BACKLOG_REMAINS"]);
});
test("actual endpoint errors remain visible", () => {
  assert.deepEqual(archiveProgressFailures({ ok: false, reason: "ARCHIVE_R2_UNBOUND", archived: 0 }, { writes: true }), ["ARCHIVE_R2_UNBOUND", "COLUMN_COUNT_undefined_EXPECTED_50"]);
});
