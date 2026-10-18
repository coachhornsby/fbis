import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGameReadiness,
  summarizeReadinessSlate,
  READINESS,
} from "../functions/lib/cfbTuesdayReadiness.js";
import { stampGamesPlayedOnCatalog } from "../functions/lib/collegeJobsCore.js";
import { classifyFeature, FITTED_NONZERO_FEATURES, buildFeatureContractReport } from "../functions/lib/cfbFeatureContract.js";
import { reconcileCollectionHealth, ALERT_CODES } from "../functions/lib/cfbCollectionAlerts.js";
import {
  reconcileWinnerAccuracyClaim,
  summarizeDiagnosticCohort,
  oct17UniverseStatus,
} from "../functions/lib/cfbOct17Reconciliation.js";
import { GAMES_PLAYED_SOURCES } from "../functions/lib/cfbGamesPlayed.js";
import { projectCfbFbisV2 } from "../functions/lib/cfbFbisV2.js";

test("stampGamesPlayedOnCatalog prefers schedule then CORE fallback", () => {
  const catalog = {
    byCanonicalId: {
      "cfb-201": {
        canonicalId: "cfb-201",
        team: "Oklahoma",
        ppaOff: -0.04,
        ppaDef: -0.16,
        coreThroughWeek: 6,
        coreWeekBounded: true,
      },
      "cfb-251": {
        canonicalId: "cfb-251",
        team: "Texas",
        ppaOff: 0.2,
        ppaDef: -0.1,
        coreThroughWeek: 6,
        coreWeekBounded: true,
      },
    },
    byEspnId: {},
  };
  const stamped = stampGamesPlayedOnCatalog(catalog, {
    scheduleBySchool: new Map([["oklahoma", 7]]),
  });
  assert.equal(stamped.byCanonicalId["cfb-201"].gamesPlayed, 7);
  assert.equal(stamped.byCanonicalId["cfb-201"].gamesPlayedSource, GAMES_PLAYED_SOURCES.SCHEDULE);
  assert.equal(stamped.byCanonicalId["cfb-251"].gamesPlayed, 6);
  assert.equal(
    stamped.byCanonicalId["cfb-251"].gamesPlayedSource,
    GAMES_PLAYED_SOURCES.CORE_THROUGH_WEEK_FALLBACK
  );
  assert.equal(stamped.byCanonicalId["cfb-251"].gamesPlayedUncertainty, true);
});

test("feature contract separates fitted nonzero from display-only", () => {
  const ppa = classifyFeature("ppaOff");
  assert.equal(ppa.influencesFittedChampion, true);
  const success = classifyFeature("offensiveSuccessRate");
  assert.equal(success.displayOnly, true);
  assert.equal(success.influencesFittedChampion, false);
  const core = classifyFeature("coreOffense");
  assert.equal(core.researchOnly, true);
  assert.ok(FITTED_NONZERO_FEATURES.includes("gamesPlayed"));
  const report = buildFeatureContractReport();
  assert.ok(report.counts.fittedNonzero >= 5);
});

test("readiness Ready vs Blocked for missing PPA", () => {
  const ready = evaluateGameReadiness({
    game: {
      id: "g1",
      home_name: "Marshall",
      away_name: "South Alabama",
      start: "2026-10-20T23:30:00.000Z",
      homeEspnId: "276",
      awayEspnId: "6",
      season: 2026,
      week: 9,
    },
    homeFeatures: {
      team: "Marshall",
      ppaOff: 0.1,
      ppaDef: -0.05,
      gamesPlayed: 6,
      gamesPlayedSource: "schedule",
      coreThroughWeek: 6,
      coreWeekBounded: true,
      snapshotAsOf: "2026-10-18T12:00:00.000Z",
      espnId: "276",
    },
    awayFeatures: {
      team: "South Alabama",
      ppaOff: 0.05,
      ppaDef: 0.02,
      gamesPlayed: 6,
      gamesPlayedSource: "schedule",
      coreThroughWeek: 6,
      coreWeekBounded: true,
      snapshotAsOf: "2026-10-18T12:00:00.000Z",
      espnId: "6",
    },
    homePrior: { priorOff: 28, priorDef: 24 },
    awayPrior: { priorOff: 26, priorDef: 25 },
  });
  assert.ok([READINESS.READY, READINESS.PROVISIONAL].includes(ready.status));
  assert.ok(ready.projection);

  const blocked = evaluateGameReadiness({
    game: {
      id: "g2",
      home_name: "A",
      away_name: "B",
      start: "2026-10-20T23:00:00.000Z",
    },
    homeFeatures: {},
    awayFeatures: {},
  });
  assert.equal(blocked.status, READINESS.BLOCKED);
  assert.ok(blocked.criticalFailures.length >= 1);

  const summary = summarizeReadinessSlate([ready, blocked]);
  assert.equal(summary.disposition, "Not ready");
});

test("collection alerts fire on overdue empty required dataset", () => {
  // Force overdue path by providing empty evidence with past window simulation
  // via explicit httpOk empty which always alerts.
  const health = reconcileCollectionHealth({
    season: 2026,
    week: 9,
    evidenceByDataset: {
      "cfbd-ppa-teams": { httpOk: true, rowCount: 0, schemaOk: true },
    },
    d1FeatureTeamCount: 20,
  });
  assert.ok(health.alerts.some((a) => a.code === ALERT_CODES.HTTP_OK_EMPTY || a.code === "http_ok_empty_payload" || a.code === "required_source_failed"));
  assert.ok(health.alerts.some((a) => a.code === ALERT_CODES.MISSING_D1_FEATURES));
});

test("Oct17 winner accuracy reconciles 57.1% against explicit denominator", () => {
  const claim = reconcileWinnerAccuracyClaim({
    correctWinners: 24,
    eligibleN: 42,
    reportedPct: 57.1,
  });
  assert.equal(claim.actualPct, 57.1);
  assert.equal(claim.consistent, true);
  const universe = oct17UniverseStatus({ closeSnapshots: 45, gradedFinals: 41 });
  assert.equal(universe.gradedFinals, 41);
  assert.equal(universe.inProgressOrUngraded, 4);
  const diag = summarizeDiagnosticCohort([
    { matchup: "a@b", projHome: 30, projAway: 20, actualHome: 28, actualAway: 21 },
    { matchup: "c@d", projHome: 24, projAway: 27, actualHome: 17, actualAway: 31 },
  ]);
  assert.equal(diag.eligibleN, 2);
  assert.equal(diag.winnerHits, 2);
  assert.equal(diag.promotionAuthorized, false);
});

test("projection includes featureContribution instrumentation", () => {
  const proj = projectCfbFbisV2({
    home: "Marshall",
    away: "South Alabama",
    cfbFbisV2Input: {
      home: { offensePpa: 0.1, defensePpa: -0.05, gamesPlayed: 6, priorOff: 28, priorDef: 24, offensiveSuccessRate: 0.45 },
      away: { offensePpa: 0.05, defensePpa: 0.02, gamesPlayed: 6, priorOff: 26, priorDef: 25 },
    },
  });
  assert.equal(proj.ok, true);
  assert.ok(proj.featureContribution);
  assert.ok(proj.featureContribution.doNotRepresentAsInfluencing.includes("offensiveSuccessRate"));
  assert.ok(proj.featureContribution.actuallyConsumed.some((c) => c.feature === "ppaOff"));
});
