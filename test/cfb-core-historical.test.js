import test from "node:test";
import assert from "node:assert/strict";
import {
  describeCfbdCoreHistoricalAvailability,
  partitionCoreRowsByThroughWeek,
  buildHistoricalCoreArchivePayloads,
  planCoreHistoricalReconstruction,
  reconstructCoreHistoricalSeason,
  assessModelCResearchReadiness,
  runModelCResearchIfReady,
  CORE_AUTHENTICITY,
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

test("reconstruction plan lists missing throughWeeks per season", () => {
  const plan = planCoreHistoricalReconstruction({
    seasons: [2025, 2026],
    existingArchives: [
      { season: 2026, through_week: 6 },
      { season: 2026, through_week: 7 },
    ],
    minThroughWeek: 5,
    maxThroughWeek: 8,
  });
  const s25 = plan.seasons.find((s) => s.season === 2025);
  const s26 = plan.seasons.find((s) => s.season === 2026);
  assert.deepEqual(s25.missingThroughWeeks, [5, 6, 7, 8]);
  assert.deepEqual(s26.archivedThroughWeeks, [6, 7]);
  assert.deepEqual(s26.missingThroughWeeks, [5, 8]);
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

test("Model C fit is blocked until multi-season throughWeek depth + PIT rows exist", () => {
  const blocked = assessModelCResearchReadiness({
    archivesBySeason: { 2026: [6, 7] },
    eligiblePitGameRows: 41,
  });
  assert.equal(blocked.readyToAttemptFit, false);
  assert.ok(blocked.missing.some((m) => m.code === "insufficient_season_throughweek_depth"));

  const ready = assessModelCResearchReadiness({
    archivesBySeason: {
      2023: [4, 5, 6, 7],
      2024: [4, 5, 6, 7],
      2025: [4, 5, 6, 7],
    },
    eligiblePitGameRows: 250,
  });
  assert.equal(ready.readyToAttemptFit, true);
  assert.equal(ready.model, "C_combined_champion_plus_core");
});

test("runModelCResearchIfReady refuses to invent OOS when corpus thin", () => {
  const out = runModelCResearchIfReady([], {
    archivesBySeason: { 2026: [6] },
    eligiblePitGameRows: 10,
  });
  assert.equal(out.ok, false);
  assert.equal(out.blocked, true);
  assert.equal(out.classification, "Unable to evaluate due to data limitations");
  assert.equal(out.canInfluenceProduction, false);
});
