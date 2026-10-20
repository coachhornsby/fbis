import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoreWeeklyArchivePayload,
  coreArchiveRowsFromPayload,
  CORE_ARCHIVE_VERSION,
  CORE_RESEARCH_ONLY,
} from "../functions/lib/cfbCoreArchive.js";

test("CORE archive version and research-only flags are stable", () => {
  assert.equal(CORE_ARCHIVE_VERSION, "cfb-core-weekly-archive-v1");
  assert.equal(CORE_RESEARCH_ONLY, true);
});

test("CORE archive keys by actual CFBD throughWeek, not budgeted targetWeek-1", () => {
  const payload = buildCoreWeeklyArchivePayload({
    season: 2026,
    targetWeek: 8,
    coreRows: [
      {
        team: "Georgia",
        year: 2026,
        throughWeek: 6,
        throughSeasonType: "regular",
        rating: 26,
        offense: 15.16,
        defense: -10.83,
      },
      {
        team: "Auburn",
        year: 2026,
        throughWeek: 6,
        throughSeasonType: "regular",
        rating: 10,
        offense: 5,
        defense: -5,
      },
    ],
    collectionTime: "2026-10-18T08:02:00Z",
    jobRunId: "test-job",
  });
  assert.equal(payload.budgetedThroughWeek, 7);
  assert.equal(payload.throughWeek, 6);
  assert.equal(payload.labelingLag, true);
  assert.equal(payload.canInfluenceProjection, false);
  assert.equal(payload.canAuthorizeWager, false);
  const rows = coreArchiveRowsFromPayload(payload);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].through_week, 6);
  assert.match(rows[0].archive_id, /^2026:6:/);
});

test("archive refuses rows when CFBD throughWeek missing", () => {
  const payload = buildCoreWeeklyArchivePayload({
    season: 2026,
    targetWeek: 8,
    coreRows: [{ team: "Ghost", year: 2026, rating: 1, offense: 1, defense: -1 }],
  });
  assert.equal(payload.throughWeek, null);
  assert.equal(coreArchiveRowsFromPayload(payload).length, 0);
});
