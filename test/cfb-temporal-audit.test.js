import test from "node:test";
import assert from "node:assert/strict";
import {
  auditCatalogForGame,
  auditFeatureForCutoff,
  auditPreseasonPriorSources,
  auditPlayerRoleResolution,
  buildModelInputProvenance,
  historicallyRejectedEndpointReport,
  rejectPostCutoffObservations,
  backfillRequestEstimate,
  HISTORICALLY_UNSAFE_ENDPOINTS,
} from "../functions/lib/cfbTemporalAudit.js";
import { assembleGameFeatures, buildPriorCatalog, buildQbFeatures } from "../functions/lib/cfbFeaturePipeline.js";
import { classifyRoleConfidence, ROLE_CONFIDENCE_TIERS } from "../functions/lib/cfbPlayerIdentity.js";
import { CFBD_FEATURE_CATALOG } from "../functions/lib/cfbdFeatureCatalog.js";
import { COLLEGE_MODELS } from "../functions/lib/collegeModels.js";

test("governance unchanged — both models cannot qualify", () => {
  assert.equal(COLLEGE_MODELS["CFB-FBIS-v2"].canQualify, false);
  assert.equal(COLLEGE_MODELS["CFB-PLAYER-v1"].canQualify, false);
});

test("historically unsafe season aggregates are rejected without reconstruction", () => {
  const report = historicallyRejectedEndpointReport();
  for (const ep of [
    "/stats/season/advanced",
    "/ppa/players/season",
    "/player/usage",
    "/stats/player/season",
    "/ppa/teams",
  ]) {
    assert.ok(HISTORICALLY_UNSAFE_ENDPOINTS.includes(ep));
    assert.ok(report.rejectedForHistoricalIndependentUse.some((r) => r.endpoint === ep));
  }
  const adv = CFBD_FEATURE_CATALOG.find((f) => f.canonical === "adv_success_offense");
  const row = auditFeatureForCutoff(adv, {
    year: 2024,
    targetWeek: 3,
    kickoffTimestamp: "2024-09-14T19:00:00.000Z",
    reconstructedFromGames: false,
    priorSeasonFreeze: false,
  });
  assert.equal(row.eligibleForIndependentProjection, false);
  assert.match(row.exclusionReason, /same-season-aggregate/);
});

test("CORE without throughWeek rejected; throughWeek after cutoff rejected; valid throughWeek accepted", () => {
  const core = CFBD_FEATURE_CATALOG.find((f) => f.canonical === "core_overall");
  const missing = auditFeatureForCutoff(core, {
    year: 2024,
    targetWeek: 5,
    kickoffTimestamp: "2024-09-28T19:00:00.000Z",
    throughWeek: null,
  });
  assert.equal(missing.eligibleForIndependentProjection, false);
  const future = auditFeatureForCutoff(core, {
    year: 2024,
    targetWeek: 5,
    kickoffTimestamp: "2024-09-28T19:00:00.000Z",
    throughWeek: 5,
  });
  assert.equal(future.eligibleForIndependentProjection, false);
  const ok = auditFeatureForCutoff(core, {
    year: 2024,
    targetWeek: 5,
    kickoffTimestamp: "2024-09-28T19:00:00.000Z",
    throughWeek: 4,
  });
  assert.equal(ok.eligibleForIndependentProjection, true);
});

test("undated same-season SP/FPI/SRS excluded; prior-season freeze accepted", () => {
  const sp = CFBD_FEATURE_CATALOG.find((f) => f.canonical === "sp_plus_overall");
  const same = auditFeatureForCutoff(sp, { year: 2024, targetWeek: 3, priorSeasonFreeze: false });
  assert.equal(same.eligibleForIndependentProjection, false);
  const prior = auditFeatureForCutoff(sp, {
    year: 2024,
    targetWeek: 3,
    priorSeasonFreeze: true,
    sourceSeason: 2023,
    kickoffTimestamp: "2024-09-14T19:00:00.000Z",
    predictionCutoff: "2024-09-14T18:59:00.000Z",
  });
  assert.equal(prior.eligibleForIndependentProjection, true);
});

test("preseason prior audit detects current-season finals leakage", () => {
  const ok = auditPreseasonPriorSources({
    gameYear: 2024,
    priorSeason: 2023,
    priorCatalogEntry: { sourceSeason: 2023, spOverall: 10, fpi: 8 },
  });
  assert.equal(ok.ok, true);
  const leak = auditPreseasonPriorSources({
    gameYear: 2024,
    priorSeason: 2023,
    priorCatalogEntry: { sourceSeason: 2024, spOverall: 99 },
  });
  assert.equal(leak.ok, false);
  assert.equal(leak.leakageIfCurrentSeasonFinals, true);
});

test("post-cutoff observations are rejected", () => {
  const kickoff = "2024-10-12T19:00:00.000Z";
  const { kept, rejected } = rejectPostCutoffObservations(
    [
      { gameId: 1, startDate: "2024-10-05T18:00:00.000Z" },
      { gameId: 2, startDate: "2024-10-12T19:00:00.000Z" },
      { gameId: 3, startDate: "2024-10-19T18:00:00.000Z" },
      { gameId: 4 },
    ],
    kickoff
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0].gameId, 1);
  assert.equal(rejected.length, 3);
});

test("intentional post-cutoff feature injection fails temporal integrity on assemble", () => {
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
  const kickoff = "2024-10-12T19:00:00.000Z";
  // Inject a future game row into rolling features
  const record = assembleGameFeatures({
    game: {
      id: "inj-1",
      season: 2024,
      week: 7,
      startDate: kickoff,
      homeTeam: "Alabama",
      awayTeam: "Georgia",
    },
    priorCatalog,
    confMap: {},
    ppaGameRows: [
      {
        team: "Alabama",
        startDate: "2024-10-19T18:00:00.000Z",
        offense: { overall: 0.9, passing: 0.5, rushing: 0.2 },
        defense: { overall: -0.1, passing: 0, rushing: 0 },
      },
    ],
    advGameRows: [],
    collectionTimestamp: new Date(Date.parse(kickoff) - 60_000).toISOString(),
    mode: "historical",
  });
  assert.equal(record.temporalOk, true);
  // Future row must not contribute to gamesPlayed
  assert.equal(record.features.home.gamesPlayed, 0);
  assert.equal(record.features.home.passEpa, null);
});

test("historical mode rejects season QB aggregates", () => {
  const blocked = buildQbFeatures({
    team: "Alabama",
    mode: "historical",
    qbRows: [{ team: "Alabama", name: "FutureQB", averagePPA: { pass: 0.5 }, games: 12 }],
    usageRows: [{ team: "Alabama", position: "QB", usage: { overall: 0.9 } }],
    kickoffTimestamp: "2024-10-12T19:00:00.000Z",
  });
  assert.equal(blocked.qbHistoricalUnsafe, true);
  assert.equal(blocked.qbPpa, null);
  assert.equal(blocked.qbStarterKnown, false);
});

test("role confidence tiers LOW/MEDIUM/HIGH and uncertain widens", () => {
  assert.equal(classifyRoleConfidence(0.2, "PRIMARY"), ROLE_CONFIDENCE_TIERS.LOW);
  assert.equal(classifyRoleConfidence(0.55, "LIKELY"), ROLE_CONFIDENCE_TIERS.MEDIUM);
  assert.equal(classifyRoleConfidence(0.9, "CONFIRMED_STARTER"), ROLE_CONFIDENCE_TIERS.HIGH);
  assert.equal(classifyRoleConfidence(0.95, "QB_UNCERTAIN"), ROLE_CONFIDENCE_TIERS.LOW);
  const audit = auditPlayerRoleResolution({
    player_name: "Test QB",
    team: "Alabama",
    position: "QB",
    role: "QB1",
    role_confidence: 0.3,
    state: "QB_UNCERTAIN",
    selection: { method: "uncertain" },
    provenance: { widenUncertainty: true },
  });
  assert.equal(audit.roleConfidenceTierAssigned, "LOW");
  assert.equal(audit.widensUncertainty, true);
  assert.equal(audit.futureEvidenceUsed, false);
});

test("catalog audit for a week-3 game rejects class D/E and unsafe aggregates", () => {
  const audit = auditCatalogForGame({
    year: 2024,
    targetWeek: 3,
    kickoffTimestamp: "2024-09-14T19:00:00.000Z",
    predictionCutoff: "2024-09-14T18:59:00.000Z",
    priorSeason: 2023,
    coreThroughWeek: 2,
  });
  assert.ok(audit.summary.rejected > 0);
  assert.ok(audit.features.some((f) => f.featureName === "closing_lines" && !f.eligibleForIndependentProjection));
  assert.ok(audit.features.some((f) => f.endpoint === "/ppa/teams" && !f.eligibleForIndependentProjection));
});

test("provenance builder keeps evaluation lines out of independent passed set", () => {
  const provenance = buildModelInputProvenance({
    game: { id: "g1", week: 2, season: 2024, startDate: "2024-09-07T19:00:00.000Z" },
    featureRecord: {
      game_id: "g1",
      season: 2024,
      week: 2,
      kickoff_timestamp: "2024-09-07T19:00:00.000Z",
      feature_cutoff_timestamp: "2024-09-07T18:59:00.000Z",
      home_team: "Alabama",
      away_team: "Georgia",
      features: {
        home: { priorOff: 34, passEpa: 0.2, qbHistoricalUnsafe: true, qbPpa: 0.9 },
        away: { priorOff: 32, passEpa: 0.1 },
        evaluation: { closingSpread: -7.5, closingTotal: 55 },
      },
    },
    mode: "historical",
  });
  assert.ok(provenance.featuresRejected.some((r) => r.featureName.startsWith("evaluation.")));
  assert.ok(provenance.featuresRejected.some((r) => r.featureName === "home.qbPpa"));
  assert.equal(provenance.targetsSeparated, true);
});

test("full backfill request estimate is reported and smoke is smaller", () => {
  const smoke = backfillRequestEstimate({ seasons: [2024], smokeWeeks: 4 });
  const full = backfillRequestEstimate({ seasons: [2022, 2023, 2024, 2025], weeksPerSeason: 15 });
  assert.ok(smoke.estimate < full.estimate);
  assert.equal(smoke.customerPageFanout ?? full.customerPageFanout, 0);
  assert.equal(full.customerPageFanout, 0);
});
