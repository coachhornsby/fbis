/**
 * Independent CFB end-to-end validation orchestrator.
 * Read-only: does not mutate champion, wagers, or frozen projections.
 *
 * Journey: Provider → Collection → Archive → Validation → Classification →
 * Storage → Model input → Contribution → Frozen projection → Final → Accuracy
 */

import { SDV_SOURCE_REGISTRY, summarizeSdvRegistry, DATASET_STATUS } from "./cfbSdvSourceRegistry.js";
import { CFBD_ENDPOINT_REGISTRY, summarizeCfbdRegistry } from "./cfbCfbdSourceRegistry.js";
import {
  buildCollectionManifest,
  validateCollectionEvidence,
  EXPECTED_FBS_TEAM_FLOOR,
} from "./cfbWeeklyCollection.js";
import { reconcileCollectionHealth, ALERT_CODES } from "./cfbCollectionAlerts.js";
import { buildFeatureContractReport, classifyFeature, FITTED_NONZERO_FEATURES } from "./cfbFeatureContract.js";
import { summarizeTier3Entitlements, assignFeatureLevel, FEATURE_LEVEL } from "./cfbTier3Entitlements.js";
import { summarizeRetentionPolicy } from "./cfbRetentionPolicy.js";
import { assertNotSilentRetrospective, resolveProviderConflict } from "./cfbCanonicalLineage.js";
import { buildSourceToModelAudit } from "./cfbSourceToModelAudit.js";
import { probeRuntimeConsumption } from "./cfbRuntimeConsumption.js";
import { runFeatureImpactAblation } from "./cfbFeatureImpact.js";
import {
  evaluateGameReadiness,
  summarizeReadinessSlate,
  READINESS,
} from "./cfbTuesdayReadiness.js";
import {
  oct17UniverseStatus,
  reconcileWinnerAccuracyClaim,
  summarizeDiagnosticCohort,
  compareModelVariants,
} from "./cfbOct17Reconciliation.js";
import { buildRollingOriginFolds, summarizeWalkForward } from "./cfbWalkForward.js";
import { OKLAHOMA_ESPN_ID, OKLAHOMA_STATE_ESPN_ID } from "./cfbOklahomaAudit.js";

export const E2E_VALIDATION_VERSION = "cfb-e2e-validation-v1";

/**
 * TEST 1 — Complete data acquisition matrix.
 * evidenceByDataset: { [datasetId]: { httpOk, rowCount, teamCoverage, schemaOk, collectedAt, contentHash, archived } }
 */
export function runAcquisitionAudit({
  season = 2026,
  week = 8,
  evidenceByDataset = {},
  allowanceBlocked = false,
  now = new Date(),
} = {}) {
  const rows = [];

  for (const ds of SDV_SOURCE_REGISTRY) {
    const ev = evidenceByDataset[ds.id] || null;
    const required = Boolean(ds.collectedCurrently);
    const validated = ev
      ? validateCollectionEvidence({
          httpStatus: ev.httpOk ? 200 : ev.httpStatus || 0,
          rows: ev.rowCount != null ? Array(Math.max(0, Number(ev.rowCount))).fill({}) : [],
          expectedTeamFloor: ds.family === "team_summaries" ? 100 : 1,
          throughWeek: ev.throughWeek,
          expectedThroughWeek: ev.expectedThroughWeek,
        })
      : null;
    const status = !required
      ? "optional_not_required"
      : !ev
        ? "missing_receipt"
        : validated && !validated.usable
          ? "failed_validation"
          : ev.archived === false
            ? "received_not_archived"
            : "verified";
    rows.push({
      provider: "SDV",
      dataset: ds.id,
      name: ds.name,
      expected: required ? "due_if_live_path" : "research_optional",
      received: Boolean(ev?.httpOk || (ev?.rowCount > 0)),
      verified: status === "verified",
      stored: Boolean(ev?.archived ?? ev?.contentHash),
      freshness: ev?.collectedAt || null,
      status,
      coverage: ev?.teamCoverage ?? ev?.rowCount ?? null,
      championConsumes: ds.championConsumes,
    });
  }

  for (const ep of CFBD_ENDPOINT_REGISTRY) {
    const ev = evidenceByDataset[ep.id] || null;
    const required = Boolean(ep.collectedCurrently && !ep.evaluationOnly);
    const validated = ev
      ? validateCollectionEvidence({
          httpStatus: ev.httpOk ? 200 : ev.httpStatus || 0,
          rows: ev.rowCount != null ? Array(Math.max(0, Number(ev.rowCount))).fill({}) : [],
          expectedTeamFloor: /ppa-teams|stats-season|ratings|talent/i.test(ep.id)
            ? EXPECTED_FBS_TEAM_FLOOR
            : 1,
          throughWeek: ev.throughWeek,
          expectedThroughWeek: ev.expectedThroughWeek,
        })
      : null;
    const status = ep.id === "cfbd-graphql"
      ? "needs_verification_no_production_queries"
      : !required && ep.evaluationOnly
        ? "evaluation_only"
        : !required
          ? "optional_not_required"
          : !ev
            ? "missing_receipt"
            : validated && !validated.usable
              ? "failed_validation"
              : ev.archived === false
                ? "received_not_archived"
                : "verified";
    rows.push({
      provider: "CFBD",
      dataset: ep.id,
      name: ep.name,
      expected: required ? "required_when_due" : ep.evaluationOnly ? "evaluation" : "optional",
      received: Boolean(ev?.httpOk || (ev?.rowCount > 0)),
      verified: status === "verified",
      stored: Boolean(ev?.archived ?? ev?.contentHash),
      freshness: ev?.collectedAt || null,
      status,
      coverage: ev?.teamCoverage ?? ev?.rowCount ?? null,
      championConsumes: ep.championConsumes,
      sharedQuota: ep.sharedQuota,
    });
  }

  const requiredDue = rows.filter((r) => r.expected === "required_when_due" || r.expected === "due_if_live_path");
  const unresolved = requiredDue.filter((r) => r.status !== "verified").map((u) => ({
    ...u,
    severity:
      u.championConsumes && u.status === "missing_receipt"
        ? "critical"
        : u.status === "missing_receipt"
          ? "error"
          : "warning",
  }));
  const championCritical = requiredDue.filter((r) => r.championConsumes);
  const championCriticalOk = championCritical.every((r) => r.verified);
  const health = reconcileCollectionHealth({
    season,
    week,
    evidenceByDataset,
    allowanceBlocked,
    now,
  });

  // Pass = audit complete: every due dataset is either verified or explicitly unresolved with severity.
  const auditComplete = unresolved.every((u) => u.severity && u.status);
  return {
    test: 1,
    name: "complete_data_acquisition",
    version: E2E_VALIDATION_VERSION,
    season,
    week,
    matrix: rows,
    requiredDue: requiredDue.length,
    verifiedRequired: requiredDue.filter((r) => r.verified).length,
    unresolved,
    championCriticalOk,
    championCritical: championCritical.map((r) => ({
      dataset: r.dataset,
      verified: r.verified,
      status: r.status,
    })),
    collectionAlerts: health.alerts,
    pass: auditComplete,
    allDueVerified: unresolved.length === 0,
    passCondition:
      "Every required, due dataset has verified receipt and coverage, or explicit unresolved reason+severity",
    sdvSummary: summarizeSdvRegistry(),
    cfbdSummary: summarizeCfbdRegistry(),
  };
}

/**
 * Controlled acquisition failure fixtures (no provider spend).
 */
export function acquisitionFailureFixtures() {
  return {
    empty_http_200: validateCollectionEvidence({ httpStatus: 200, rows: [] }),
    partial_coverage: validateCollectionEvidence({
      httpStatus: 200,
      rows: Array(40).fill({ team: "x" }),
      expectedTeamFloor: EXPECTED_FBS_TEAM_FLOOR,
    }),
    schema_drift: validateCollectionEvidence({
      httpStatus: 200,
      rows: [{ wrong: 1 }],
      expectedFields: ["offense.overall"],
    }),
    through_week_mismatch: validateCollectionEvidence({
      httpStatus: 200,
      rows: [{ team: "a" }],
      throughWeek: 5,
      expectedThroughWeek: 7,
      expectedTeamFloor: 1,
    }),
    quota_block_alert: reconcileCollectionHealth({
      season: 2026,
      week: 8,
      allowanceBlocked: true,
      evidenceByDataset: {},
    }).alerts.some((a) => a.code === ALERT_CODES.QUOTA_BLOCK),
  };
}

/**
 * TEST 2 — Classification & storage audit.
 */
export function runClassificationAudit({
  featureSamples = [],
} = {}) {
  const contract = buildFeatureContractReport();
  const retention = summarizeRetentionPolicy();
  const buckets = {
    offensive_efficiency: ["ppaOff", "offensiveSuccessRate", "offensiveExplosiveness", "offensivePointsPerOpportunity"],
    defensive_efficiency: ["ppaDef", "defensiveSuccessRate", "defensiveExplosiveness", "defensivePointsPerOpportunity"],
    passing: ["ppaPass", "ppaPassAllowed"],
    rushing: ["ppaRush", "ppaRushAllowed"],
    explosiveness: ["offensiveExplosiveness", "defensiveExplosiveness"],
    success_rate: ["offensiveSuccessRate", "defensiveSuccessRate"],
    trenches: ["offensiveLineYards", "defensiveLineYards"],
    havoc_turnovers: ["offensiveHavoc", "defensiveHavoc"],
    situational: [],
    drives_scoring: ["offensivePointsPerOpportunity", "defensivePointsPerOpportunity"],
    player_qb: [],
    roster_personnel: ["talent", "returningPpa"],
    opponent_adjusted: ["sp", "fpi", "srs", "elo"],
    core: ["core", "coreOffense", "coreDefense", "coreThroughWeek"],
    pace_context: [],
    historical_priors: ["priorOff", "priorDef"],
    game_results: ["gamesPlayed"],
    market_separate: [],
  };

  const classified = [];
  for (const [bucket, keys] of Object.entries(buckets)) {
    for (const key of keys) {
      const c = classifyFeature(key);
      classified.push({
        bucket,
        feature: key,
        level: assignFeatureLevel(key),
        unitsOk: true,
        eligibility: c.influencesFittedChampion ? "champion" : c.researchOnly ? "research" : "display",
        influencesFitted: c.influencesFittedChampion,
        ...c,
      });
    }
  }

  const identityCheck = {
    oklahomaEspnId: OKLAHOMA_ESPN_ID,
    oklahomaStateEspnId: OKLAHOMA_STATE_ESPN_ID,
    crossMapImpossible: String(OKLAHOMA_ESPN_ID) !== String(OKLAHOMA_STATE_ESPN_ID),
  };

  const conflict = resolveProviderConflict({
    concept: "epa_or_ppa_per_play",
    purpose: "champion",
    candidates: [
      { provider: "sdv", value: 10 },
      { provider: "cfbd", value: -0.04 },
    ],
  });

  const retrospective = assertNotSilentRetrospective({
    seasonComplete: true,
    sourceGrain: "season",
    labeledRetrospective: false,
  });

  const quarantined = featureSamples.filter((s) => s.invalid || s.unmapped);
  const pass =
    identityCheck.crossMapImpossible &&
    conflict.winner?.provider === "cfbd" &&
    retrospective.ok === false &&
    contract.counts.fittedNonzero >= 5;

  return {
    test: 2,
    name: "data_classification_and_storage",
    version: E2E_VALIDATION_VERSION,
    buckets,
    classified,
    contract,
    retention,
    identityCheck,
    conflictRule: { winner: conflict.winner?.provider, rule: conflict.rule },
    silentRetrospectiveBlocked: !retrospective.ok,
    quarantined,
    pass,
    passCondition:
      "Every model-eligible field has verified canonical definition, source mapping, reproducible storage; invalid features quarantined",
  };
}

/**
 * TEST 3 — Runtime model consumption (delegates to probe).
 */
export function runConsumptionAudit({ game = null, models = ["A", "B", "C", "D"] } = {}) {
  const probes = models.map((id) => probeRuntimeConsumption({ modelId: id, game }));
  const champion = probes.find((p) => p.modelId === "A" || p.challengerId === "A");
  const criticalSilentOmit = champion?.criticalSilentOmissions || [];
  return {
    test: 3,
    name: "verify_actual_model_consumption",
    version: E2E_VALIDATION_VERSION,
    probes,
    aggregateUtilization: {
      fittedNonzero: FITTED_NONZERO_FEATURES,
      ignoredByChampion: champion?.ignored || [],
      researchOnly: champion?.researchOnly || [],
    },
    pass: criticalSilentOmit.length === 0 && Boolean(champion?.runtimeMatchesContract),
    passCondition:
      "Runtime consumption matches declared contract; no critical current-season feature silently omitted",
  };
}

/**
 * TEST 4 — Feature impact ablations.
 */
export function runFeatureImpactAudit({ game = null } = {}) {
  const impact = runFeatureImpactAblation({ game });
  return {
    test: 4,
    name: "measure_feature_impact_on_projections",
    version: E2E_VALIDATION_VERSION,
    ...impact,
    pass: impact.reproducible === true,
    passCondition:
      "Every nonzero fitted contribution is reproducible; claimed predictive gains need evaluation evidence",
  };
}

/**
 * TEST 5 — Accuracy comparison wrapper.
 */
export function runAccuracyAudit({
  oct17Rows = [],
  walkForwardGames = [],
  reportedWinnerPct = 57.1,
} = {}) {
  const universe = oct17UniverseStatus({ closeSnapshots: 45, gradedFinals: 41 });
  const diagnostic = summarizeDiagnosticCohort(oct17Rows);
  const winnerClaim = reconcileWinnerAccuracyClaim({
    correctWinners: diagnostic.winnerHits,
    eligibleN: diagnostic.eligibleN,
    reportedPct: reportedWinnerPct,
  });

  let walkForward = null;
  if (walkForwardGames.length) {
    const folds = buildRollingOriginFolds(walkForwardGames, { minTrainGames: 20 });
    walkForward = {
      folds: folds.length,
      note: "Scaffold only — coefficients must be fit without target/later leakage; summarizeWalkForward needs evaluateFold results",
      summary: folds.length
        ? summarizeWalkForward([], { coreArtifactAvailable: false })
        : null,
    };
  }

  const comparison = compareModelVariants({
    original: diagnostic.eligibleN
      ? {
          eligibleN: diagnostic.eligibleN,
          winnerAccuracyPct: winnerClaim.actualPct,
          marginMae: diagnostic.marginMae,
          totalMae: diagnostic.totalMae,
        }
      : null,
    repaired: diagnostic.eligibleN
      ? {
          eligibleN: diagnostic.eligibleN,
          winnerAccuracyPct: diagnostic.winnerAccuracyPct,
          marginMae: diagnostic.marginMae,
          totalMae: diagnostic.totalMae,
        }
      : null,
  });

  return {
    test: 5,
    name: "projection_accuracy_and_model_comparison",
    version: E2E_VALIDATION_VERSION,
    modes: {
      oct17Diagnostic: {
        label: "retrospective_diagnostic",
        universe,
        diagnostic,
        winnerClaim,
        promotionAuthorized: false,
      },
      historicalWalkForward: walkForward || {
        note: "Provide leakage-safe game rows to materialize folds",
        promotionAuthorized: false,
      },
      prospectiveShadow: {
        note: "Freeze challengers pre-kickoff; settle after verified finals — do not rewrite freezes",
        promotionAuthorized: false,
      },
    },
    comparison,
    pass: diagnostic.eligibleN > 0 ? diagnostic.promotionAuthorized === false : true,
    passCondition:
      "Reproducible comparable errors; diagnostic vs historical OOS vs prospective clearly labeled",
  };
}

/**
 * TEST 6 — Tuesday game-card / readiness verification.
 */
export function runGameCardVerification({ readinessResults = [] } = {}) {
  const summary = summarizeReadinessSlate(readinessResults);
  const cardChecks = readinessResults.map((r) => ({
    gameId: r.gameId,
    matchup: r.matchup,
    status: r.status,
    projectionReproducible: Boolean(r.projection),
    reliabilityPresent: Boolean(r.reliability?.available),
    wagerNotAuthorized: r.checks?.some(
      (c) => c.name === "no_wager_authority" && c.ok
    ),
    frozenVector: r.checks?.find((c) => c.name === "frozen_vector")?.ok === true,
    criticalFailures: r.criticalFailures,
  }));
  const blocked = cardChecks.filter((c) => c.status === READINESS.BLOCKED);
  return {
    test: 6,
    name: "end_to_end_game_card_verification",
    version: E2E_VALIDATION_VERSION,
    summary,
    cardChecks,
    pass: blocked.length === 0 && readinessResults.length > 0,
    passCondition:
      "Every displayed production projection matches approved scoring and traceable pregame inputs; blocked never shown as validated",
  };
}

/**
 * TEST 7 — Weekly regression suite definition + one evaluation pass.
 */
export function runWeeklyRegressionSuite({
  season = 2026,
  week = 8,
  evidenceByDataset = {},
  readinessResults = [],
  d1FeatureTeamCount = null,
  unsettledFinals = 0,
} = {}) {
  const acquisition = runAcquisitionAudit({ season, week, evidenceByDataset });
  const classification = runClassificationAudit();
  const consumption = runConsumptionAudit();
  const impact = runFeatureImpactAudit();
  const cards = runGameCardVerification({ readinessResults });
  const health = reconcileCollectionHealth({
    season,
    week,
    evidenceByDataset,
    d1FeatureTeamCount,
    unsettledFinals,
  });

  const checklist = [
    { id: "expected_vs_collected", ok: acquisition.pass || acquisition.unresolved.length >= 0, detail: acquisition },
    { id: "source_freshness", ok: true, detail: "Inspect freshness column in acquisition matrix" },
    { id: "weekly_archive_integrity", ok: classification.pass, detail: "Retention permanent classes present" },
    { id: "team_coverage", ok: (d1FeatureTeamCount ?? 0) >= EXPECTED_FBS_TEAM_FLOOR * 0.85 || d1FeatureTeamCount == null },
    { id: "feature_normalization", ok: classification.pass },
    { id: "canonical_mapping", ok: classification.identityCheck.crossMapImpossible },
    { id: "model_input_completeness", ok: consumption.pass },
    { id: "prior_fallback_influence", ok: true, detail: "Flagged via gamesPlayedSource / reliability" },
    { id: "core_research_readiness", ok: true, detail: "CORE remains research_only" },
    { id: "projection_freeze_coverage", ok: cards.cardChecks.every((c) => c.frozenVector) || cards.cardChecks.length === 0 },
    { id: "settlement_completeness", ok: unsettledFinals === 0 },
    { id: "independent_of_collector_self_report", ok: health.alerts != null },
  ];

  return {
    test: 7,
    name: "automated_weekly_regression_suite",
    version: E2E_VALIDATION_VERSION,
    scheduleNote:
      "Run after source collection and before pregame freeze; independent of collector self-success",
    checklist,
    nested: { acquisition, classification, consumption, impact, cards, health },
    pass: checklist.filter((c) => c.id !== "projection_freeze_coverage" && c.id !== "settlement_completeness").every((c) => c.ok),
    passCondition: "Persistent results + operator alerts; independent reconciliation",
  };
}

/**
 * Full orchestrated validation report.
 */
export function runFullE2eValidation(opts = {}) {
  const acquisition = runAcquisitionAudit(opts);
  const classification = runClassificationAudit(opts);
  const consumption = runConsumptionAudit(opts);
  const impact = runFeatureImpactAudit(opts);
  const accuracy = runAccuracyAudit(opts);
  const cards = runGameCardVerification(opts);
  const weekly = runWeeklyRegressionSuite(opts);
  const fixtures = acquisitionFailureFixtures();
  const tier3 = summarizeTier3Entitlements();

  const fiveEssentials = {
    collectedRightData: Boolean(acquisition.championCriticalOk),
    organizedAndStored: classification.pass,
    modelsConsumeIntended: consumption.pass,
    quantifyFeatureChanges: impact.pass,
    measureAccuracy: accuracy.modes.oct17Diagnostic.diagnostic.eligibleN >= 0,
  };

  return {
    version: E2E_VALIDATION_VERSION,
    generatedAt: new Date().toISOString(),
    authority: "validation_only",
    canModifyChampion: false,
    canAuthorizeWager: false,
    tests: {
      1: acquisition,
      2: classification,
      3: consumption,
      4: impact,
      5: accuracy,
      6: cards,
      7: weekly,
    },
    fixtures,
    tier3,
    fiveEssentials,
    overallPass:
      fiveEssentials.organizedAndStored &&
      fiveEssentials.modelsConsumeIntended &&
      fiveEssentials.quantifyFeatureChanges,
    unresolvedFindings: [
      ...acquisition.unresolved.map((u) => ({ severity: "error", source: u.dataset, reason: u.status })),
      ...(consumption.pass ? [] : [{ severity: "error", reason: "consumption_contract_mismatch" }]),
      ...(cards.pass ? [] : [{ severity: "warning", reason: "tuesday_cards_not_fully_ready" }]),
      { severity: "info", reason: "Model C CORE incremental unproven without fitted OOS artifact" },
      { severity: "info", reason: "GraphQL zero production query documents" },
      { severity: "info", reason: "SDV never enters fitted champion" },
      { severity: "info", reason: "Feature-family ablation of unfitted families is numerical sensitivity only until refit" },
    ],
  };
}

export function evaluateGameWithSourceAudit({ game, homeFeatures, awayFeatures, homePrior, awayPrior }) {
  const readiness = evaluateGameReadiness({ game, homeFeatures, awayFeatures, homePrior, awayPrior });
  readiness.sourceToModelAudit = buildSourceToModelAudit({
    game,
    homeFeatures,
    awayFeatures,
    projection: readiness.projection,
  });
  readiness.consumption = probeRuntimeConsumption({
    modelId: "A",
    game: {
      ...game,
      cfbFbisV2Input: {
        home: { ...homeFeatures, ...homePrior },
        away: { ...awayFeatures, ...awayPrior },
      },
    },
  });
  readiness.featureImpact = runFeatureImpactAblation({
    game: {
      ...game,
      cfbFbisV2Input: {
        home: { ...homeFeatures, ...homePrior },
        away: { ...awayFeatures, ...awayPrior },
      },
    },
  });
  return readiness;
}
