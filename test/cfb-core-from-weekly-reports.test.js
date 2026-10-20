import test from "node:test";
import assert from "node:assert/strict";
import {
  mapAdjustedEpaToFbisCore,
  parseWeeklyTrainingReportCsv,
  buildFbisCoreArchiveFromWeeklyReport,
  reconstructFbisCoreFromWeeklyReports,
  fbisCoreArchiveToHoldoutRows,
  FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
  FBIS_CORE_EPA_SCALE,
  describeFbisCoreFromWeeklyReports,
} from "../functions/lib/cfbCoreFromWeeklyReports.js";
import { buildCfbCoreMatchupVector } from "../functions/lib/cfbCoreChallenger.js";
import {
  indexCoreArchivesBySeasonWeek,
  buildEligibleCoreHoldoutRows,
  runCore2025Train2026HoldoutReport,
} from "../functions/lib/cfbCoreHoldout.js";
import { CORE_AUTHENTICITY } from "../functions/lib/cfbCoreHistorical.js";

test("EPA→CORE mapping uses per-100 scale and CFBD-like defense sign", () => {
  const m = mapAdjustedEpaToFbisCore({
    adjustedEpa: 0.2,
    adjustedEpaAllowed: 0.1,
  });
  assert.equal(m.ok, true);
  assert.equal(m.offense, 0.2 * FBIS_CORE_EPA_SCALE);
  assert.equal(m.defense, -(0.1 * FBIS_CORE_EPA_SCALE));
  assert.equal(m.overall, m.offense + m.defense);
  assert.ok(m.defense < 0, "good/low allowed EPA becomes negative defense");
});

test("weekly report schedule week W yields throughWeek W-1 archive", () => {
  const csv = [
    "id,season,week,start_date,home_team,away_team,home_adjusted_epa,home_adjusted_epa_allowed,away_adjusted_epa,away_adjusted_epa_allowed",
    "1,2025,5,2025-09-27 16:00:00,Georgia,Alabama,0.30,0.10,0.25,0.12",
    "2,2025,5,2025-09-27 19:00:00,Auburn,Ole Miss,0.15,0.18,0.20,0.14",
  ].join("\n");
  const parsed = parseWeeklyTrainingReportCsv(csv);
  assert.equal(parsed.rows.length, 2);
  const archive = buildFbisCoreArchiveFromWeeklyReport({
    scheduleWeek: 5,
    season: 2025,
    gameRows: parsed.rows,
  });
  assert.equal(archive.ok, true);
  assert.equal(archive.throughWeek, 4);
  assert.equal(archive.scheduleWeek, 5);
  assert.equal(archive.sourceEndpoint, FBIS_CORE_WEEKLY_SOURCE_ENDPOINT);
  assert.equal(archive.authenticityClass, CORE_AUTHENTICITY.WEEKLY_TRAINING_DOCUMENT);
  assert.ok(archive.teamCount >= 4);
  const georgia = archive.teams.find((t) => t.schoolKey === "georgia");
  assert.ok(georgia);
  assert.equal(georgia.coreOffense, 30);
  assert.equal(georgia.coreDefense, -10);
});

test("matchup vector accepts fbis_weekly_training_document endpoint", () => {
  const v = buildCfbCoreMatchupVector({
    season: 2025,
    week: 6,
    kickoff: "2025-10-04T19:00:00.000Z",
    baselineHome: 28,
    baselineAway: 24,
    home: {
      coreYear: 2025,
      coreThroughWeek: 5,
      coreOffense: 30,
      coreDefense: -10,
      coreWeekBounded: true,
      coreThroughSeasonType: "regular",
      coreSourceEndpoint: FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
      coreSourceAsOf: "2025-10-03T12:00:00.000Z",
    },
    away: {
      coreYear: 2025,
      coreThroughWeek: 5,
      coreOffense: 20,
      coreDefense: -8,
      coreWeekBounded: true,
      coreThroughSeasonType: "regular",
      coreSourceEndpoint: FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
      coreSourceAsOf: "2025-10-03T12:00:00.000Z",
    },
  });
  assert.equal(v.ok, true);
  assert.equal(v.coreSourceEndpoint, FBIS_CORE_WEEKLY_SOURCE_ENDPOINT);
  assert.match(v.lineage.source, /weekly training/i);
});

test("reconstructed weekly archives drive 2025→2026 holdout without CFBD", () => {
  const reports = [];
  for (const season of [2025, 2026]) {
    const maxWeek = season === 2025 ? 10 : 7;
    for (let week = 5; week <= maxWeek; week++) {
      const rows = [];
      const teams = ["Georgia", "Alabama", "Auburn", "Ole Miss"];
      for (let i = 0; i < 20; i++) {
        const home = teams[i % teams.length];
        const away = teams[(i + 1) % teams.length];
        rows.push({
          gameId: `${season}-w${week}-${i}`,
          season,
          week,
          kickoff: `${season}-09-${String(Math.min(28, 7 + week)).padStart(2, "0")}T19:00:00.000Z`,
          homeTeam: home,
          awayTeam: away,
          homeAdjustedEpa: 0.2 + (i % 5) * 0.02,
          homeAdjustedEpaAllowed: 0.12,
          awayAdjustedEpa: 0.15,
          awayAdjustedEpaAllowed: 0.14,
        });
      }
      reports.push({ season, week, rows });
    }
  }
  const reconstructed = reconstructFbisCoreFromWeeklyReports(reports);
  assert.equal(reconstructed.ok, true);
  assert.ok(reconstructed.coverage.find((c) => c.season === 2025).distinctThroughWeeks >= 3);
  assert.ok(reconstructed.coverage.find((c) => c.season === 2026).distinctThroughWeeks >= 1);

  const indexed = indexCoreArchivesBySeasonWeek(reconstructed.archiveRows);
  const sample = indexed.bySeason[2025][4]["georgia"];
  assert.equal(sample.coreSourceEndpoint, FBIS_CORE_WEEKLY_SOURCE_ENDPOINT);

  const games = [];
  let n = 0;
  for (let week = 5; week <= 10; week++) {
    for (let i = 0; i < 20; i++) {
      n += 1;
      const margin = ((i % 7) - 3) * 3;
      games.push({
        gameId: `2025-${n}`,
        season: 2025,
        week,
        kickoff: `2025-09-${String(Math.min(28, 7 + week)).padStart(2, "0")}T19:00:00.000Z`,
        homeTeam: ["Georgia", "Alabama", "Auburn", "Ole Miss"][i % 4],
        awayTeam: ["Georgia", "Alabama", "Auburn", "Ole Miss"][(i + 1) % 4],
        actualHome: 28 + margin,
        actualAway: 28,
        finalVerified: true,
        baselineHome: 27 + margin * 0.5,
        baselineAway: 24,
      });
    }
  }
  for (let week = 5; week <= 7; week++) {
    for (let i = 0; i < 20; i++) {
      n += 1;
      const margin = ((i % 5) - 2) * 4;
      games.push({
        gameId: `2026-${n}`,
        season: 2026,
        week,
        kickoff: `2026-09-${String(Math.min(28, 7 + week)).padStart(2, "0")}T19:00:00.000Z`,
        homeTeam: ["Georgia", "Alabama", "Auburn", "Ole Miss"][i % 4],
        awayTeam: ["Georgia", "Alabama", "Auburn", "Ole Miss"][(i + 2) % 4],
        actualHome: 30 + margin,
        actualAway: 24,
        finalVerified: true,
        baselineHome: 28,
        baselineAway: 24,
      });
    }
  }

  const built = buildEligibleCoreHoldoutRows({
    games,
    archiveRows: reconstructed.archiveRows,
  });
  assert.ok(built.counts.train2025 >= 100, JSON.stringify(built.counts));
  assert.ok(built.counts.holdout2026 >= 50, JSON.stringify(built.counts));
  assert.equal(built.eligible[0].authenticityClass, CORE_AUTHENTICITY.WEEKLY_TRAINING_DOCUMENT);

  const report = runCore2025Train2026HoldoutReport({
    games,
    archiveRows: reconstructed.archiveRows,
    cfbdAccess: false,
    minTrainGames: 100,
    minEvalGames: 50,
  });
  assert.equal(report.blocked, false, JSON.stringify(report.blockers));
  assert.equal(report.ok, true);
  assert.ok(report.coefficients?.frozen);
  assert.ok(report.holdout2026?.metrics?.combined);
  assert.ok(report.headToHeadVsChampionAA);
});

test("describe dual-source design keeps CFBD optional", () => {
  const d = describeFbisCoreFromWeeklyReports();
  assert.equal(d.primarySource, "fbis_weekly_training_documents");
  assert.equal(d.optionalOverlay, "cfbd_ratings_core_api");
  assert.equal(d.researchOnly, true);
});

test("fbisCoreArchiveToHoldoutRows stamps weekly endpoint", () => {
  const rows = fbisCoreArchiveToHoldoutRows({
    ok: true,
    season: 2025,
    throughWeek: 4,
    authenticityClass: CORE_AUTHENTICITY.WEEKLY_TRAINING_DOCUMENT,
    collectionTime: "2025-09-20T12:00:00.000Z",
    teams: [
      {
        schoolKey: "georgia",
        team: "Georgia",
        core: 20,
        coreOffense: 30,
        coreDefense: -10,
        throughSeasonType: "regular",
      },
    ],
  });
  assert.equal(rows[0].coreSourceEndpoint, FBIS_CORE_WEEKLY_SOURCE_ENDPOINT);
});
