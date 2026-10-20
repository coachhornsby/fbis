import test from "node:test";
import assert from "node:assert/strict";
import {
  describeCfbdCoreHistoricalAvailability,
  describeFbisCoreResearchSeasonPolicy,
  preferUpdatedWeeklyTrainingDocuments,
  verifyWeeklyReportCutoff,
  partitionCoreRowsByThroughWeek,
  buildHistoricalCoreArchivePayloads,
  planCoreHistoricalReconstruction,
  reconstructCoreHistoricalSeason,
  assessModelCResearchReadiness,
  runModelCResearchIfReady,
  CORE_AUTHENTICITY,
  FBIS_WEEKLY_TRAINING_FIRST_SEASON,
} from "../functions/lib/cfbCoreHistorical.js";
import { trackCorePublicationRelease } from "../functions/lib/cfbCoreContinuity.js";

function yearFixture(season) {
  const teams = ["Georgia", "Alabama", "Auburn"];
  const rows = [];
  for (const throughWeek of [4, 5, 6]) {
    for (const team of teams) {
      rows.push({
        year: season,
        team,
        throughWeek,
        throughSeasonType: "regular",
        overall: 10 + throughWeek + team.length * 0.01,
        offense: 5 + throughWeek * 0.1,
        defense: -5 - throughWeek * 0.1,
        modelVersion: "fixture-v1",
      });
    }
  }
  // Undated + postseason noise must not pollute regular buckets.
  rows.push({
    year: season,
    team: "Ghost",
    overall: 1,
    offense: 1,
    defense: -1,
    throughSeasonType: "regular",
  });
  rows.push({
    year: season,
    team: "Georgia",
    throughWeek: 1,
    throughSeasonType: "postseason",
    overall: 99,
    offense: 1,
    defense: -1,
  });
  return rows;
}

test("CFBD historical CORE availability is documented as retrospective weekly stored", () => {
  const a = describeCfbdCoreHistoricalAvailability();
  assert.equal(a.weeklySnapshots, true);
  assert.equal(a.seasonCoverage.first, 2016);
  assert.equal(a.authenticity.class, CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED);
  assert.match(a.authenticity.cfbdStatement, /retrospective/i);
  assert.equal(a.canAuthorizeWager, false);
});

test("partition preserves every distinct throughWeek and rejects undated", () => {
  const p = partitionCoreRowsByThroughWeek(yearFixture(2025));
  assert.deepEqual(p.throughWeeks, [4, 5, 6]);
  assert.equal(p.buckets[5].rowCount, 3);
  assert.equal(p.undatedRejected, 1);
  assert.ok(p.seasonTypeSkipped >= 1);
});

test("historical payloads archive each distinct throughWeek without collapsing", () => {
  const built = buildHistoricalCoreArchivePayloads({
    season: 2025,
    yearRows: yearFixture(2025),
    existingThroughWeeks: [4],
  });
  assert.equal(built.payloads.length, 2);
  assert.deepEqual(
    built.payloads.map((p) => p.throughWeek).sort((a, b) => a - b),
    [5, 6]
  );
  assert.equal(built.skipped[0].throughWeek, 4);
  assert.equal(built.authenticityClass, CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED);
  for (const p of built.payloads) {
    assert.equal(p.historicalReconstruction, true);
    assert.equal(p.throughWeek, p.teams[0].throughWeek);
    assert.ok(p.teamCount >= 3);
  }
});

test("season policy: 2025 first weekly-training season; 2024 not assumed", () => {
  const p = describeFbisCoreResearchSeasonPolicy();
  assert.equal(p.weeklyTrainingDocumentsFirstSeason, 2025);
  assert.equal(FBIS_WEEKLY_TRAINING_FIRST_SEASON, 2025);
  assert.equal(p.modelC.minSeasonsFixedRequirement, false);
  assert.equal(p.modelC.trainFoundationSeason, 2025);
  assert.equal(p.modelC.evaluateSeason, 2026);
  assert.equal(p.modelC.freezeHoldout, true);
  assert.equal(p.modelC.neverTuneOnEvaluateSeason, true);
  assert.equal(p.modelC.neverRefitOnEvaluateSeason, true);
  assert.ok(p.seasons.some((s) => s.season === "2024_and_earlier" && s.weeklyTrainingDocuments === false));
});

test("preferUpdatedWeeklyTrainingDocuments dedupes same season/week", () => {
  const d = preferUpdatedWeeklyTrainingDocuments([
    "training_data_2025_week12.csv",
    "training_data_2025_week12_updated_35aa.csv",
    "training_data_2025_week13_0ef0.csv",
  ]);
  const w12 = d.preferred.find((x) => x.week === 12);
  assert.match(w12.filename, /updated/i);
  assert.equal(w12.candidates.length, 2);
});

test("verifyWeeklyReportCutoff requires throughWeek < schedule week", () => {
  assert.equal(verifyWeeklyReportCutoff({ weekField: 8, claimedStatisticalThroughWeek: 7 }).ok, true);
  assert.equal(verifyWeeklyReportCutoff({ weekField: 8, claimedStatisticalThroughWeek: 8 }).ok, false);
});

test("reconstruction plan prioritizes 2025–2026; skips 2024 weekly-doc parity", () => {
  const plan = planCoreHistoricalReconstruction({
    seasons: [2024, 2025, 2026],
    existingArchives: [
      { season: 2026, through_week: 6 },
      { season: 2026, through_week: 7 },
    ],
    minThroughWeek: 5,
    maxThroughWeek: 8,
  });
  const s24 = plan.seasons.find((s) => s.season === 2024);
  const s25 = plan.seasons.find((s) => s.season === 2025);
  const s26 = plan.seasons.find((s) => s.season === 2026);
  assert.equal(s24.action, "skip_no_equivalent_weekly_training_documents");
  assert.deepEqual(s25.missingThroughWeeks, [5, 6, 7, 8]);
  assert.equal(s25.role, "historical_foundation_train");
  assert.deepEqual(s26.archivedThroughWeeks, [6, 7]);
  assert.deepEqual(s26.missingThroughWeeks, [5, 8]);
  assert.ok(plan.immediatePriorities[0].includes("2025"));
});

test("reconstructCoreHistoricalSeason persists one archive per distinct week", async () => {
  const persisted = [];
  const result = await reconstructCoreHistoricalSeason(
    {},
    {
      season: 2025,
      existingThroughWeeks: [],
      fetchYearRows: async () => yearFixture(2025),
      persist: async (_env, payload) => {
        persisted.push(payload.throughWeek);
        return { ok: true, written: payload.teamCount, throughWeek: payload.throughWeek };
      },
    }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(persisted.sort((a, b) => a - b), [4, 5, 6]);
  assert.equal(result.authenticityClass, CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED);
});

test("publication tracking records genuine W6→W8 deltas and timestamps", () => {
  const track = trackCorePublicationRelease({
    baselineThroughWeek: 6,
    currentThroughWeek: 8,
    baselineCollectionTime: "2026-10-18T08:02:25.540Z",
    currentCollectionTime: "2026-10-27T12:00:00.000Z",
    baseline: [{ schoolKey: "georgia", core: 26, coreOffense: 15, coreDefense: -11 }],
    current: [{ schoolKey: "georgia", core: 28.5, coreOffense: 16, coreDefense: -12 }],
  });
  assert.equal(track.classification, "distinct_publish_with_rating_changes");
  assert.equal(track.genuineMoves, 1);
  assert.equal(track.topMoves[0].deltaCore, 2.5);
  assert.equal(track.timestamps.currentCollectionTime, "2026-10-27T12:00:00.000Z");
  assert.equal(track.canAuthorizeWager, false);
});

test("publication tracking flags identical label advance as non-movement", () => {
  const track = trackCorePublicationRelease({
    baselineThroughWeek: 6,
    currentThroughWeek: 7,
    baseline: [{ schoolKey: "georgia", core: 26, coreOffense: 15, coreDefense: -11 }],
    current: [{ schoolKey: "georgia", core: 26, coreOffense: 15, coreDefense: -11 }],
  });
  assert.equal(track.classification, "label_advance_without_value_change");
  assert.equal(track.genuineMoves, 0);
});

test("Model C uses evidence-based eligibility; two seasons can pass without a third", () => {
  const blocked = assessModelCResearchReadiness({
    archivesBySeason: { 2026: [6, 7] },
    eligiblePitGameRows: 41,
    verifiedHistoricalCutoffs: false,
  });
  assert.equal(blocked.readyToAttemptFit, false);
  assert.equal(blocked.fixedThreeSeasonRequirement, false);
  assert.equal(blocked.eligibilityMode, "evidence_based");
  assert.ok(blocked.missing.some((m) => m.code === "unverified_historical_cutoffs"));

  const ready = assessModelCResearchReadiness({
    archivesBySeason: {
      2025: [5, 6, 7, 8, 9],
      2026: [5, 6],
    },
    trainGameRows: 400,
    testGameRows: 120,
    verifiedHistoricalCutoffs: true,
    trainSeason: 2025,
    testSeason: 2026,
  });
  assert.equal(ready.readyToAttemptFit, true);
  assert.equal(ready.model, "C_combined_champion_plus_core");
  assert.equal(ready.fitPolicy.trainFoundationSeason, 2025);
  assert.equal(ready.fitPolicy.evaluateSeason, 2026);
  assert.equal(ready.sampleSize.trainGameRows, 400);
  assert.ok(ready.uncertainty.approxSeScale != null);
});

test("runModelCResearchIfReady refuses to invent OOS when corpus thin", () => {
  const out = runModelCResearchIfReady([], {
    archivesBySeason: { 2026: [6] },
    eligiblePitGameRows: 10,
    verifiedHistoricalCutoffs: false,
  });
  assert.equal(out.ok, false);
  assert.equal(out.blocked, true);
  assert.equal(out.classification, "Unable to evaluate due to data limitations");
  assert.equal(out.canInfluenceProduction, false);
});
