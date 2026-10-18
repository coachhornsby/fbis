/**
 * Tuesday validation repair unit tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reconcileDueDatasets, DUE_CLASS } from "../functions/lib/cfbCollectionReconciliation.js";
import { buildMatchedCohortComparison } from "../functions/lib/cfbOct17MatchedCohort.js";
import { evaluateWeeklyAutomationSequence, WEEKLY_STEPS } from "../functions/lib/cfbWeeklyAutomationSequence.js";
import {
  buildManifestRow,
  buildR2ArchiveManifestRow,
  CFBD_PATH_TO_DATASET,
} from "../functions/lib/cfbCollectionManifestPersist.js";
import { listRequiredDatasets } from "../functions/lib/cfbWeeklyCollection.js";

test("collection reconciliation distinguishes persistence gap vs not due vs failure", () => {
  const recon = reconcileDueDatasets({
    season: 2026,
    week: 8,
    evidenceByDataset: {
      "cfbd-ppa-teams": {
        httpOk: true,
        rowCount: 160,
        teamCoverage: 160,
        contentHash: "x",
        archived: true,
        collectedAt: "2026-10-18T00:00:00.000Z",
      },
    },
    livePresence: {
      "cfbd-games": { present: true, rowCount: 100, source: "d1.games" },
    },
    pregameFreezeFailed: false,
  });
  assert.ok(listRequiredDatasets().length >= 10);
  const ppa = recon.rows.find((r) => r.datasetId === "cfbd-ppa-teams");
  assert.equal(ppa.classification, DUE_CLASS.VERIFIED);
  const games = recon.rows.find((r) => r.datasetId === "cfbd-games");
  assert.equal(games.classification, DUE_CLASS.COLLECTED_NO_RECEIPT);
  const pit = recon.rows.find((r) => r.datasetId === "sdv-pit-fallback");
  assert.equal(pit.classification, DUE_CLASS.CONDITIONAL_SKIPPED);
  const weekly = recon.rows.find((r) => r.datasetId === "cfbd-ppa-games");
  assert.equal(weekly.classification, DUE_CLASS.COLLECTION_FAILED);
});

test("matched cohort separates denominators and never claims promotion", () => {
  const rows = [
    {
      eligible: true,
      original: { home: 30, away: 20 },
      rebuilt: { home: 28, away: 21, ok: true },
      actual: { home: 27, away: 24 },
    },
    {
      eligible: true,
      original: { home: 24, away: 24 },
      rebuilt: { home: 25, away: 22, ok: true },
      actual: { home: 31, away: 17 },
    },
    {
      eligible: true,
      original: { home: null, away: null },
      rebuilt: { home: 20, away: 20, ok: true },
      actual: { home: 21, away: 14 },
    },
  ];
  const m = buildMatchedCohortComparison(rows);
  assert.equal(m.denominators.closeUniverse, 3);
  assert.equal(m.denominators.gradedFinals, 3);
  assert.equal(m.denominators.matchedComparable, 2);
  assert.equal(m.promotionAuthorized, false);
  assert.equal(m.originalOnMatched.n, 2);
  assert.equal(m.repairedOnMatched.n, 2);
});

test("weekly automation sequence detects missed freeze and order", () => {
  assert.ok(WEEKLY_STEPS.length >= 5);
  const seq = evaluateWeeklyAutomationSequence({
    season: 2026,
    week: 8,
    receiptsByStep: {
      collection: { ranAt: "2026-10-18T08:00:00.000Z", ok: true },
      validation: { ranAt: "2026-10-18T09:00:00.000Z", ok: true },
    },
    freezeDeadline: "2026-10-20T22:00:00.000Z",
    now: new Date("2026-10-18T12:00:00.000Z"),
  });
  assert.ok(seq.missedRuns.includes("freeze"));
  assert.equal(seq.steps[0].id, "collection");
  assert.equal(seq.steps[1].id, "validation");
  assert.equal(seq.steps[2].id, "freeze");
});

test("manifest row builder never invents success without httpOk", () => {
  const row = buildManifestRow({
    season: 2026,
    week: 8,
    provider: "cfbd",
    datasetId: "cfbd-ppa-teams",
    required: true,
    httpOk: false,
    httpStatus: 429,
    rowCount: 0,
  });
  assert.equal(row.http_ok, 0);
  assert.match(row.status, /failed|blocked/i);
});

test("CFBD path map covers weekly reconstruction and player boxes", () => {
  assert.equal(CFBD_PATH_TO_DATASET["/ppa/games"], "cfbd-ppa-games");
  assert.equal(CFBD_PATH_TO_DATASET["/stats/game/advanced"], "cfbd-stats-game-advanced");
  assert.equal(CFBD_PATH_TO_DATASET["/games/teams"], "cfbd-games-teams-players");
  assert.equal(CFBD_PATH_TO_DATASET["/games/players"], "cfbd-games-teams-players");
});

test("R2 archive receipt requires a real object key", () => {
  assert.equal(buildR2ArchiveManifestRow({ datasetId: "cfbd-ppa-games" }), null);
  const row = buildR2ArchiveManifestRow({
    season: 2026,
    week: 8,
    datasetId: "cfbd-ppa-games",
    r2Key: "raw/cfbd/cfb/2026/ppa_games/week-7:ppaGames/08e33188f1d9.json",
    objectBytes: 7281,
    throughWeek: 7,
    uploadedAt: "2026-10-17T16:32:29.742Z",
  });
  assert.equal(row.http_ok, 1);
  assert.match(row.content_hash, /^r2:/);
  assert.match(row.evidence_json, /r2_archive_reconcile/);
});
