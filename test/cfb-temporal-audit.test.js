import test from "node:test";
import assert from "node:assert/strict";
import {
  auditPreseasonPriorSources,
  auditCoreProvenance,
  auditReconstructedFeatureProvenance,
  assertSourceObservationsBeforeKickoff,
  buildModelInputProvenance,
  rejectPostCutoffObservations,
  TEMPORAL_AUDIT_VERSION,
} from "../functions/lib/cfbTemporalAudit.js";
import { assembleGameFeatures, buildPriorCatalog } from "../functions/lib/cfbFeaturePipeline.js";
import { COLLEGE_MODELS } from "../functions/lib/collegeModels.js";

const KICK = "2024-10-12T19:00:00.000Z";
const CUTOFF = "2024-10-12T18:59:00.000Z";

test("governance unchanged", () => {
  assert.equal(COLLEGE_MODELS["CFB-FBIS-v2"].canQualify, false);
  assert.equal(COLLEGE_MODELS["CFB-PLAYER-v1"].canQualify, false);
  assert.match(TEMPORAL_AUDIT_VERSION, /v2/);
});

test("A: post-kickoff source rejected even if labeled earlier week", () => {
  const check = assertSourceObservationsBeforeKickoff({
    targetKickoffTimestamp: KICK,
    targetPredictionCutoff: CUTOFF,
    observations: [
      {
        sourceGameId: "future",
        sourceKickoffTimestamp: "2024-10-19T18:00:00.000Z",
        sourceWeek: 3, // false label
        week: 3,
        endpoint: "/ppa/games",
      },
    ],
  });
  assert.equal(check.ok, false);
  assert.ok(check.rejected.some((r) => r.reason === "source-kickoff-on-or-after-target"));
});

test("B: missing prior sourceSeason fails closed — no default to expected", () => {
  const missingEntry = auditPreseasonPriorSources({
    gameYear: 2024,
    priorSeason: 2023,
    priorCatalogEntry: null,
  });
  assert.equal(missingEntry.ok, false);
  assert.equal(missingEntry.sourceSeason, null);
  assert.equal(missingEntry.exclusionReason, "missing-source-provenance");

  const missingField = auditPreseasonPriorSources({
    gameYear: 2024,
    priorSeason: 2023,
    priorCatalogEntry: { spOverall: 12 }, // no sourceSeason key
  });
  assert.equal(missingField.ok, false);
  assert.equal(missingField.sourceSeason, null);
  assert.equal(missingField.exclusionReason, "missing-source-provenance");
});

test("C: current-season prior data fails when prior-season freeze required", () => {
  const leak = auditPreseasonPriorSources({
    gameYear: 2024,
    priorSeason: 2023,
    priorCatalogEntry: { sourceSeason: 2024, spOverall: 20 },
  });
  assert.equal(leak.ok, false);
  assert.equal(leak.leakageIfCurrentSeasonFinals, true);
  assert.match(leak.exclusionReason, /current-season/);
});

test("D: CORE with throughWeek >= targetWeek fails", () => {
  const failEq = auditCoreProvenance({
    coreRow: { year: 2024, throughWeek: 5, throughSeasonType: "regular", rating: 0.2 },
    targetWeek: 5,
    targetKickoffTimestamp: KICK,
  });
  assert.equal(failEq.ok, false);
  const failGt = auditCoreProvenance({
    coreRow: { year: 2024, throughWeek: 6, throughSeasonType: "regular", rating: 0.2 },
    targetWeek: 5,
    targetKickoffTimestamp: KICK,
  });
  assert.equal(failGt.ok, false);
});

test("E: CORE with valid actual throughWeek <= targetWeek-1 passes", () => {
  const ok = auditCoreProvenance({
    coreRow: { year: 2024, throughWeek: 4, throughSeasonType: "regular", rating: 0.2 },
    targetWeek: 5,
    targetKickoffTimestamp: KICK,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.actualThroughWeek, 4);
  assert.equal(ok.latestAllowedWeek, 4);
  assert.notEqual(ok.actualThroughWeek, null);
});

test("F: rolling feature composed entirely of pre-kickoff sources passes", () => {
  const audit = auditReconstructedFeatureProvenance({
    featureName: "home.passEpa",
    endpoint: "/ppa/games",
    targetKickoffTimestamp: KICK,
    targetPredictionCutoff: CUTOFF,
    targetWeek: 7,
    observations: [
      {
        sourceGameId: "g1",
        sourceKickoffTimestamp: "2024-09-28T18:00:00.000Z",
        sourceSeason: 2024,
        sourceWeek: 5,
      },
      {
        sourceGameId: "g2",
        sourceKickoffTimestamp: "2024-10-05T18:00:00.000Z",
        sourceSeason: 2024,
        sourceWeek: 6,
      },
    ],
  });
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.actualSourceWeeks.sort(), [5, 6]);
  assert.equal(audit.latestAllowedWeek, 6);
});

test("G: one contaminated source game fails reconstructed provenance", () => {
  const audit = auditReconstructedFeatureProvenance({
    featureName: "home.passEpa",
    endpoint: "/ppa/games",
    targetKickoffTimestamp: KICK,
    targetPredictionCutoff: CUTOFF,
    targetWeek: 7,
    observations: [
      {
        sourceGameId: "ok",
        sourceKickoffTimestamp: "2024-10-05T18:00:00.000Z",
        sourceWeek: 6,
      },
      {
        sourceGameId: "bad",
        sourceKickoffTimestamp: "2024-10-19T18:00:00.000Z",
        sourceWeek: 4, // lying week label
      },
    ],
  });
  assert.equal(audit.ok, false);
  assert.match(audit.exclusionReason, /contaminated-source/);
});

test("H: evaluation lines remain incapable of entering independent features", () => {
  const provenance = buildModelInputProvenance({
    game: { id: "g1", week: 2, season: 2024, startDate: KICK },
    featureRecord: {
      game_id: "g1",
      season: 2024,
      week: 2,
      kickoff_timestamp: KICK,
      feature_cutoff_timestamp: CUTOFF,
      home_team: "Alabama",
      away_team: "Georgia",
      features: {
        home: {
          priorOff: 34,
          priorSourceSeason: 2023,
          sourceObservations: [
            {
              sourceGameId: "p1",
              sourceKickoffTimestamp: "2024-10-05T18:00:00.000Z",
              sourceWeek: 6,
              endpoint: "/ppa/games",
            },
          ],
          passEpa: 0.2,
        },
        away: {
          priorOff: 32,
          priorSourceSeason: 2023,
          sourceObservations: [
            {
              sourceGameId: "p2",
              sourceKickoffTimestamp: "2024-10-05T18:00:00.000Z",
              sourceWeek: 6,
              endpoint: "/ppa/games",
            },
          ],
          passEpa: 0.1,
        },
        evaluation: { closingSpread: -7.5, closingTotal: 55 },
      },
    },
    priorAudits: {
      home: auditPreseasonPriorSources({
        gameYear: 2024,
        priorSeason: 2023,
        priorCatalogEntry: { sourceSeason: 2023, spOverall: 10, priorOff: 34, priorDef: 16 },
      }),
      away: auditPreseasonPriorSources({
        gameYear: 2024,
        priorSeason: 2023,
        priorCatalogEntry: { sourceSeason: 2023, spOverall: 8, priorOff: 32, priorDef: 18 },
      }),
    },
    mode: "historical",
  });
  assert.ok(provenance.featuresRejected.some((r) => r.featureName.startsWith("evaluation.") && r.exclusionReason === "evaluation-only"));
  assert.ok(!provenance.independentFeaturesPassed.some((r) => String(r.featureName).startsWith("evaluation.")));
  assert.equal(provenance.provenancePass, true);
});

test("absent reconstructed values do not fail provenance; present without sources do", () => {
  const priorOk = auditPreseasonPriorSources({
    gameYear: 2024,
    priorSeason: 2023,
    priorCatalogEntry: { sourceSeason: 2023, spOverall: 10, priorOff: 30, priorDef: 20 },
  });
  const absentOk = buildModelInputProvenance({
    game: { id: "w1", week: 1, season: 2024, startDate: KICK },
    featureRecord: {
      week: 1,
      season: 2024,
      kickoff_timestamp: KICK,
      feature_cutoff_timestamp: CUTOFF,
      features: {
        home: {
          priorOff: 30,
          priorDef: 20,
          priorSourceSeason: 2023,
          sourceObservations: [],
          qbHistoricalUnsafe: true,
          qbSourceEndpoint: "/ppa/players/season",
          qbPpa: null,
        },
        away: {
          priorOff: 28,
          priorDef: 18,
          priorSourceSeason: 2023,
          sourceObservations: [],
          qbHistoricalUnsafe: true,
          qbPpa: null,
        },
        evaluation: {},
      },
    },
    priorAudits: { home: priorOk, away: priorOk },
    mode: "historical",
  });
  assert.equal(absentOk.provenancePass, true);

  const presentNoSrc = buildModelInputProvenance({
    game: { id: "bad", week: 2, season: 2024, startDate: KICK },
    featureRecord: {
      week: 2,
      season: 2024,
      kickoff_timestamp: KICK,
      feature_cutoff_timestamp: CUTOFF,
      features: {
        home: { priorOff: 30, priorSourceSeason: 2023, sourceObservations: [], passEpa: 0.2 },
        away: { priorOff: 28, priorSourceSeason: 2023, sourceObservations: [] },
        evaluation: {},
      },
    },
    priorAudits: { home: priorOk, away: priorOk },
    mode: "historical",
  });
  assert.equal(presentNoSrc.provenancePass, false);
});

test("assemble drops post-kickoff rows from rolling features (timestamp gated)", () => {
  const priorCatalog = buildPriorCatalog({
    season: 2023,
    endpoints: {
      sp: { data: [{ team: "Alabama", offense: { rating: 35 }, defense: { rating: 16 }, rating: 20 }] },
      fpi: { data: [] },
      srs: { data: [] },
      elo: { data: [] },
      core: { data: [] },
      talent: { data: [] },
      returning: { data: [] },
      recruiting: { data: [] },
      ppaTeams: { data: [] },
    },
  });
  assert.equal(priorCatalog.bySchool.alabama.sourceSeason, 2023);
  const record = assembleGameFeatures({
    game: {
      id: "inj-1",
      season: 2024,
      week: 7,
      startDate: KICK,
      homeTeam: "Alabama",
      awayTeam: "Georgia",
    },
    priorCatalog,
    confMap: {},
    ppaGameRows: [
      {
        team: "Alabama",
        gameId: "future",
        week: 2,
        startDate: "2024-10-19T18:00:00.000Z",
        offense: { overall: 0.9, passing: 0.5, rushing: 0.2 },
        defense: { overall: -0.1, passing: 0, rushing: 0 },
      },
      {
        team: "Alabama",
        gameId: "past",
        week: 6,
        startDate: "2024-10-05T18:00:00.000Z",
        offense: { overall: 0.2, passing: 0.1, rushing: 0.05 },
        defense: { overall: 0, passing: 0, rushing: 0 },
      },
    ],
    advGameRows: [],
    collectionTimestamp: CUTOFF,
    mode: "historical",
  });
  assert.equal(record.features.home.gamesPlayed, 1);
  assert.deepEqual(record.features.home.rollingSourceGameIds, ["past"]);
  assert.ok(record.features.home.sourceObservations.every((o) => Date.parse(o.sourceKickoffTimestamp) < Date.parse(KICK)));
});

test("rejectPostCutoffObservations still rejects undated and future rows", () => {
  const { kept, rejected } = rejectPostCutoffObservations(
    [
      { gameId: 1, startDate: "2024-10-05T18:00:00.000Z", week: 6 },
      { gameId: 2, startDate: "2024-10-19T18:00:00.000Z", week: 1 },
      { gameId: 3, week: 1 },
    ],
    KICK
  );
  assert.equal(kept.length, 1);
  assert.equal(rejected.length, 2);
});
