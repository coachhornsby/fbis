/**
 * Historical CORE research reconstruction and Model C readiness.
 *
 * Two datasets must stay distinct:
 * 1. FBIS preserved weekly training documents (first complete season: 2025)
 * 2. CFBD `/ratings/core` API stored weekly throughWeek rows (2016+, retrospective)
 *
 * Do not assume they share a publication history. Research-only — never promotes
 * champion A/A or authorizes wagers.
 */

import { normalizeCoreRating } from "./cfbdCanonical.js";
import {
  buildCoreWeeklyArchivePayload,
  persistCoreWeeklyArchive,
  CORE_RESEARCH_ONLY,
} from "./cfbCoreArchive.js";
import { CFB_CORE_ADVANCED_AUTHORITY } from "./cfbCoreAdvancedPlumbing.js";
import { evaluateCfbCoreResearch } from "./cfbCoreEvaluation.js";

export const CORE_HISTORICAL_VERSION = "cfb-core-historical-v2";
/** First season with preserved FBIS weekly training documents. */
export const FBIS_WEEKLY_TRAINING_FIRST_SEASON = 2025;

export const CORE_DATA_SOURCE = Object.freeze({
  WEEKLY_TRAINING_DOCUMENTS: "fbis_weekly_training_documents",
  CFBD_RATINGS_CORE_API: "cfbd_ratings_core_api",
});

export const CORE_AUTHENTICITY = Object.freeze({
  /** Distinct throughWeek rows from CFBD year endpoint; methodology may be retrospective. */
  RETROSPECTIVE_CFBD_STORED: "retrospective_cfbd_stored",
  /** Captured live during the season with collection_time near that week. */
  CONTEMPORANEOUS_COLLECTION: "contemporaneous_collection",
  /** Preserved FBIS weekly training document (2025+); not CFBD API history. */
  WEEKLY_TRAINING_DOCUMENT: "weekly_training_document",
  /** Budgeted label without a distinct CFBD throughWeek publish. */
  LABEL_ONLY_DUPLICATE: "label_only_duplicate",
  UNKNOWN: "unknown",
});

/**
 * Season treatment for FBIS CORE research (weekly training documents timeline).
 * CFBD API coverage is separate and must not be conflated with this table.
 */
export function describeFbisCoreResearchSeasonPolicy() {
  return {
    version: CORE_HISTORICAL_VERSION,
    weeklyTrainingDocumentsFirstSeason: FBIS_WEEKLY_TRAINING_FIRST_SEASON,
    sourcesRemainDistinct: [
      CORE_DATA_SOURCE.WEEKLY_TRAINING_DOCUMENTS,
      CORE_DATA_SOURCE.CFBD_RATINGS_CORE_API,
    ],
    seasons: [
      {
        season: "2024_and_earlier",
        treatment: "do_not_assume_equivalent_weekly_training_documents",
        weeklyTrainingDocuments: false,
        note: "No preserved FBIS weekly training-report sequence; do not invent parity with 2025+.",
      },
      {
        season: 2025,
        treatment: "first_historical_season_build_complete_weekly_sequence",
        weeklyTrainingDocuments: true,
        role: "historical_foundation_train",
        note: "Reconstruct full weekly sequence; prefer *updated* docs; verify cutoff through designated week.",
      },
      {
        season: 2026,
        treatment: "second_season_continue_weekly_and_prospective_validation",
        weeklyTrainingDocuments: true,
        role: "chronological_evaluation",
        note: "Continue weekly snapshots + prospective shadow validation; primary OOS evaluation period vs 2025 train.",
      },
      {
        season: "2027_onward",
        treatment: "expand_longitudinal_dataset",
        weeklyTrainingDocuments: true,
        role: "longitudinal_expansion",
        note: "Add seasons only as preserved weekly documents accumulate.",
      },
    ],
    modelC: {
      trainFoundationSeason: 2025,
      evaluateSeason: 2026,
      minSeasonsFixedRequirement: false,
      eligibility: "evidence_based",
      /** Preferred design: never use 2026 for both tune and evaluate. */
      freezeHoldout: true,
      tuneRegularizationWithinTrainSeasonOnly: true,
      neverRefitOnEvaluateSeason: true,
      neverTuneOnEvaluateSeason: true,
      holdoutModule: "cfbCoreHoldout.js",
    },
    researchOnly: true,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

/**
 * CFBD product facts used for planning (no network).
 * Source: api.collegefootballdata.com/core-ratings + data-availability.
 */
export function describeCfbdCoreHistoricalAvailability() {
  return {
    version: CORE_HISTORICAL_VERSION,
    dataSource: CORE_DATA_SOURCE.CFBD_RATINGS_CORE_API,
    endpoint: "/ratings/core",
    query: { required: "year or team", optional: ["conference"] },
    returns: "TeamCoreRating[] including throughWeek, throughSeasonType, modelVersion",
    seasonCoverage: { first: 2016, through: "present" },
    weeklySnapshots: true,
    distinctFromWeeklyTrainingDocuments: true,
    authenticity: {
      class: CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
      cfbdStatement:
        "Historical ratings are retrospective results from the released methodology rather than a record of what the model would have reported at that point in time.",
      implication:
        "throughWeek boundaries are authentic stored endpoints and must be preserved distinctly; do not treat reconstructed archives as contemporaneous publication timestamps unless collection_time proves live capture. Do not equate CFBD API history with FBIS weekly training documents (first season 2025).",
    },
    fbisWeeklyTrainingPolicy: describeFbisCoreResearchSeasonPolicy(),
    researchOnly: CORE_RESEARCH_ONLY,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

/**
 * Prefer *updated* weekly training filenames when multiple docs exist for the same season/week.
 * Does not parse proprietary CSV contents — selection policy only.
 */
export function preferUpdatedWeeklyTrainingDocuments(files = []) {
  const byKey = new Map();
  for (const f of files || []) {
    const name = String(f?.filename || f?.name || f || "");
    const m = name.match(/training_data_(\d{4})_(?:week(\d{2})|postseason)/i);
    if (!m) continue;
    const season = Number(m[1]);
    const week = m[2] ? Number(m[2]) : 1;
    const key = `${season}:${week}:${/postseason/i.test(name) ? "post" : "reg"}`;
    const updated = /updated/i.test(name);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { key, season, week, filename: name, preferred: updated, candidates: [name] });
      continue;
    }
    prev.candidates.push(name);
    if (updated && !prev.preferred) {
      prev.filename = name;
      prev.preferred = true;
    }
  }
  return {
    dataSource: CORE_DATA_SOURCE.WEEKLY_TRAINING_DOCUMENTS,
    preferred: [...byKey.values()].sort((a, b) => a.season - b.season || a.week - b.week),
    dedupeRule: "prefer_filename_containing_updated_for_same_season_week",
  };
}

/**
 * Verify a weekly training/report cutoff claim.
 * weekField is the slate/schedule week; statistical through-week must be < weekField.
 */
export function verifyWeeklyReportCutoff({
  weekField = null,
  claimedStatisticalThroughWeek = null,
  featureAsOfVerified = false,
  pointInTimeStatus = null,
} = {}) {
  const week = num(weekField);
  const through = num(claimedStatisticalThroughWeek);
  const ok =
    week != null &&
    week >= 1 &&
    through != null &&
    through >= 1 &&
    through < week;
  return {
    ok,
    weekField: week,
    claimedStatisticalThroughWeek: through,
    featureAsOfVerified: featureAsOfVerified === true,
    pointInTimeStatus: pointInTimeStatus || null,
    rule: "statistical_throughWeek_must_be_strictly_less_than_schedule_weekField",
    dataSourceNote:
      "Weekly training documents and CFBD /ratings/core are separate; verify cutoffs per source.",
  };
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Partition raw /ratings/core year rows into distinct throughWeek buckets.
 * Does not collapse weeks — every distinct throughWeek is retained.
 */
export function partitionCoreRowsByThroughWeek(rows = [], { seasonType = "regular" } = {}) {
  const buckets = new Map();
  let undated = 0;
  let seasonTypeSkipped = 0;
  for (const raw of rows || []) {
    const r = normalizeCoreRating(raw);
    if (r.throughWeek == null || !Number.isInteger(r.throughWeek) || r.throughWeek < 1) {
      undated += 1;
      continue;
    }
    if (
      seasonType &&
      r.throughSeasonType &&
      String(r.throughSeasonType).toLowerCase() !== String(seasonType).toLowerCase()
    ) {
      seasonTypeSkipped += 1;
      continue;
    }
    const key = r.throughWeek;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(raw);
  }
  const throughWeeks = [...buckets.keys()].sort((a, b) => a - b);
  return {
    version: CORE_HISTORICAL_VERSION,
    seasonType,
    throughWeeks,
    distinctThroughWeekCount: throughWeeks.length,
    undatedRejected: undated,
    seasonTypeSkipped,
    buckets: Object.fromEntries(
      throughWeeks.map((w) => [
        w,
        {
          throughWeek: w,
          rowCount: buckets.get(w).length,
          rows: buckets.get(w),
        },
      ])
    ),
  };
}

/**
 * Build one archive payload per distinct throughWeek from a year response.
 * targetWeek is set to throughWeek+1 (pregame bound convention) for provenance only.
 */
export function buildHistoricalCoreArchivePayloads({
  season,
  yearRows = [],
  seasonType = "regular",
  collectionTime = null,
  jobRunId = null,
  authenticityClass = CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
  existingThroughWeeks = [],
} = {}) {
  const availability = describeCfbdCoreHistoricalAvailability();
  const partitioned = partitionCoreRowsByThroughWeek(yearRows, { seasonType });
  const existing = new Set((existingThroughWeeks || []).map(Number));
  const collected = collectionTime || new Date().toISOString();
  const payloads = [];
  const skipped = [];

  for (const tw of partitioned.throughWeeks) {
    if (existing.has(tw)) {
      skipped.push({ throughWeek: tw, reason: "already_archived" });
      continue;
    }
    const bucket = partitioned.buckets[tw];
    const payload = buildCoreWeeklyArchivePayload({
      season,
      targetWeek: tw + 1,
      coreRows: bucket.rows,
      collectionTime: collected,
      publicationTime: null,
      ingestionBatchId: `core-hist:${season}:tw${tw}:${authenticityClass}`,
      jobRunId,
      sourceEndpoint: "/ratings/core",
    });
    // Force archive key to the partitioned throughWeek even if mixed rows appear.
    if (payload.throughWeek !== tw) {
      payload.throughWeek = tw;
      payload.labelingLag = payload.budgetedThroughWeek != null && tw < payload.budgetedThroughWeek;
      payload.teams = (payload.teams || []).filter((t) => Number(t.throughWeek) === tw);
      payload.teamCount = payload.teams.length;
    }
    payload.authenticityClass = authenticityClass;
    payload.authenticityNote = availability.authenticity.cfbdStatement;
    payload.historicalReconstruction = true;
    payloads.push(payload);
  }

  return {
    version: CORE_HISTORICAL_VERSION,
    season: Number(season),
    authenticityClass,
    availability,
    partitioned: {
      throughWeeks: partitioned.throughWeeks,
      distinctThroughWeekCount: partitioned.distinctThroughWeekCount,
      undatedRejected: partitioned.undatedRejected,
      seasonTypeSkipped: partitioned.seasonTypeSkipped,
    },
    payloads,
    skipped,
    researchOnly: true,
    authority: CFB_CORE_ADVANCED_AUTHORITY,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

/**
 * Plan reconstruction for FBIS weekly-training timeline (default 2025–2026).
 * 2024-and-earlier are listed as out-of-scope for equivalent weekly training docs.
 * CFBD API reconstruct remains optional and separately labeled.
 */
export function planCoreHistoricalReconstruction({
  seasons = [2025, 2026],
  existingArchives = [],
  minThroughWeek = 1,
  maxThroughWeek = 15,
  includePre2025CfbdApi = false,
} = {}) {
  const policy = describeFbisCoreResearchSeasonPolicy();
  const bySeason = new Map();
  for (const row of existingArchives || []) {
    const s = Number(row.season ?? row.year);
    const tw = Number(row.through_week ?? row.throughWeek);
    if (!Number.isFinite(s) || !Number.isFinite(tw)) continue;
    if (!bySeason.has(s)) bySeason.set(s, new Set());
    bySeason.get(s).add(tw);
  }

  const plan = (seasons || []).map((season) => {
    const s = Number(season);
    const have = [...(bySeason.get(s) || [])].sort((a, b) => a - b);
    if (s < FBIS_WEEKLY_TRAINING_FIRST_SEASON) {
      return {
        season: s,
        archivedThroughWeeks: have,
        distinctArchived: have.length,
        missingThroughWeeks: [],
        weeklyTrainingDocuments: false,
        treatment: "do_not_assume_equivalent_weekly_training_documents",
        action: includePre2025CfbdApi
          ? "optional_cfbd_api_only_retrospective_not_weekly_training_parity"
          : "skip_no_equivalent_weekly_training_documents",
        dataSource: includePre2025CfbdApi
          ? CORE_DATA_SOURCE.CFBD_RATINGS_CORE_API
          : null,
      };
    }
    const expected = [];
    for (let w = minThroughWeek; w <= maxThroughWeek; w++) expected.push(w);
    const missing = expected.filter((w) => !have.includes(w));
    return {
      season: s,
      archivedThroughWeeks: have,
      distinctArchived: have.length,
      missingThroughWeeks: missing,
      weeklyTrainingDocuments: true,
      treatment:
        s === 2025
          ? "first_historical_season_build_complete_weekly_sequence"
          : s === 2026
            ? "second_season_continue_weekly_and_prospective_validation"
            : "expand_longitudinal_dataset",
      action: missing.length
        ? "reconstruct_weekly_feature_states_dedupe_updated_verify_cutoffs"
        : "complete",
      role: s === 2025 ? "historical_foundation_train" : s === 2026 ? "chronological_evaluation" : "longitudinal",
      dataSources: [
        CORE_DATA_SOURCE.WEEKLY_TRAINING_DOCUMENTS,
        CORE_DATA_SOURCE.CFBD_RATINGS_CORE_API,
      ],
      note: "Keep weekly training documents and CFBD /ratings/core archives labeled separately.",
    };
  });

  return {
    version: CORE_HISTORICAL_VERSION,
    policy,
    availability: describeCfbdCoreHistoricalAvailability(),
    seasons: plan,
    totalDistinctArchives: plan.reduce((n, s) => n + s.distinctArchived, 0),
    immediatePriorities: [
      "Reconstruct available 2025 weekly CORE feature states (complete sequence)",
      "Deduplicate updated weekly training documents (prefer *updated*)",
      "Verify each report contains only data through its designated week (throughWeek < schedule week)",
      "Compare subsequent-game projections against champion A/A",
      "Continue 2026 weekly snapshots + prospective validation as chronological eval period",
    ],
    nextSteps: [
      "Do not backfill 2024-and-earlier as equivalent weekly training documents",
      "Optional CFBD /ratings/core year reconstruct remains labeled retrospective_cfbd_stored and distinct",
      "Fit Model C when evidence-based eligibility passes (not a fixed three-season wait)",
      "Report sample size and uncertainty on every Model C evaluation",
    ],
    researchOnly: true,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

/**
 * Fetch one season from CFBD and archive every distinct throughWeek.
 * Inject fetchYearRows for tests; production uses cfbdGet.
 */
export async function reconstructCoreHistoricalSeason(env, {
  season,
  existingThroughWeeks = [],
  jobRunId = null,
  fetchYearRows = null,
  persist = persistCoreWeeklyArchive,
  authenticityClass = CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
} = {}) {
  if (!Number.isInteger(Number(season)) || Number(season) < 2016) {
    return { ok: false, reason: "invalid_season", season, researchOnly: true };
  }
  if (typeof fetchYearRows !== "function") {
    return {
      ok: false,
      reason: "fetchYearRows_required",
      note: "Caller must supply CFBD year fetcher; this module does not invent network access",
      researchOnly: true,
    };
  }

  const yearRows = await fetchYearRows(Number(season));
  if (!Array.isArray(yearRows)) {
    return { ok: false, reason: "cfbd_year_rows_invalid", season, researchOnly: true };
  }

  const built = buildHistoricalCoreArchivePayloads({
    season: Number(season),
    yearRows,
    existingThroughWeeks,
    jobRunId,
    authenticityClass,
    collectionTime: new Date().toISOString(),
  });

  const writes = [];
  for (const payload of built.payloads) {
    const saved = await persist(env, payload);
    writes.push({
      throughWeek: payload.throughWeek,
      ok: saved?.ok === true,
      written: saved?.written ?? 0,
      reason: saved?.reason ?? null,
      authenticityClass: payload.authenticityClass,
      teamCount: payload.teamCount,
    });
  }

  const writtenWeeks = writes.filter((w) => w.ok).map((w) => w.throughWeek);
  return {
    ok: writes.every((w) => w.ok) || (writes.length === 0 && built.skipped.length > 0),
    version: CORE_HISTORICAL_VERSION,
    season: Number(season),
    authenticityClass,
    availability: built.availability,
    partitioned: built.partitioned,
    skipped: built.skipped,
    writes,
    writtenThroughWeeks: writtenWeeks,
    researchOnly: true,
    authority: CFB_CORE_ADVANCED_AUTHORITY,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

/**
 * Model C = Combined champion baseline + CORE cross terms (see evaluateCfbCoreResearch).
 *
 * Evidence-based eligibility (not a fixed three-season wait):
 * - verified historical cutoffs
 * - enough independent games (report n + uncertainty)
 * - valid chronological train/test separation (default: train≤2025, test=2026)
 * - reproducible OOS path available
 *
 * Two seasons (2025 foundation → 2026 eval) are sufficient when evidence passes.
 */
export function assessModelCResearchReadiness({
  archivesBySeason = {},
  eligiblePitGameRows = 0,
  trainGameRows = null,
  testGameRows = null,
  verifiedHistoricalCutoffs = false,
  validTrainTestSeparation = null,
  verifiedOosArtifacts = 0,
  trainSeason = 2025,
  testSeason = 2026,
  minDistinctThroughWeeksTrain = 3,
  minTrainRows = 100,
  minTestRows = 50,
  minEligibleRows = null,
} = {}) {
  const policy = describeFbisCoreResearchSeasonPolicy();
  const seasons = Object.keys(archivesBySeason || {})
    .map(Number)
    .filter((s) => Number.isFinite(s))
    .sort((a, b) => a - b);
  const perSeason = seasons.map((s) => {
    const weeks = [...new Set((archivesBySeason[s] || []).map(Number).filter((w) => w > 0))].sort(
      (a, b) => a - b
    );
    return { season: s, throughWeeks: weeks, distinct: weeks.length };
  });
  const trainArchive = perSeason.find((s) => s.season === Number(trainSeason)) || {
    season: Number(trainSeason),
    throughWeeks: [],
    distinct: 0,
  };
  const testArchive = perSeason.find((s) => s.season === Number(testSeason)) || {
    season: Number(testSeason),
    throughWeeks: [],
    distinct: 0,
  };

  const nTrain = trainGameRows != null ? Number(trainGameRows) : null;
  const nTest = testGameRows != null ? Number(testGameRows) : null;
  const nEligible = Number(eligiblePitGameRows) || 0;
  // If split counts omitted, require eligible pool large enough to support both folds.
  const effectiveMinEligible =
    minEligibleRows != null ? Number(minEligibleRows) : minTrainRows + minTestRows;

  const separationOk =
    validTrainTestSeparation === true ||
    (validTrainTestSeparation == null &&
      Number(trainSeason) < Number(testSeason) &&
      trainArchive.distinct > 0);

  const missing = [];
  if (verifiedHistoricalCutoffs !== true) {
    missing.push({
      code: "unverified_historical_cutoffs",
      have: verifiedHistoricalCutoffs,
      need: "Each weekly state verified throughWeek < schedule week (per source)",
    });
  }
  if (trainArchive.distinct < minDistinctThroughWeeksTrain) {
    missing.push({
      code: "insufficient_train_season_throughweeks",
      have: trainArchive,
      need: `Train season ${trainSeason} with ≥${minDistinctThroughWeeksTrain} distinct weekly feature states`,
    });
  }
  if (!separationOk) {
    missing.push({
      code: "invalid_train_test_separation",
      have: { trainSeason, testSeason, validTrainTestSeparation },
      need: `Chronological separation with trainSeason (${trainSeason}) < testSeason (${testSeason})`,
    });
  }
  if (nTrain != null || nTest != null) {
    if (!(nTrain >= minTrainRows)) {
      missing.push({
        code: "insufficient_train_games",
        have: nTrain,
        need: `≥${minTrainRows} independent train games`,
      });
    }
    if (!(nTest >= minTestRows)) {
      missing.push({
        code: "insufficient_test_games",
        have: nTest,
        need: `≥${minTestRows} independent unseen test games`,
      });
    }
  } else if (!(nEligible >= effectiveMinEligible)) {
    missing.push({
      code: "insufficient_independent_games",
      have: nEligible,
      need: `≥${effectiveMinEligible} independent PIT games (or provide trainGameRows/testGameRows)`,
    });
  }

  const sampleSize = {
    eligiblePitGameRows: nEligible,
    trainGameRows: nTrain,
    testGameRows: nTest,
    trainSeason: Number(trainSeason),
    testSeason: Number(testSeason),
    trainThroughWeeks: trainArchive.distinct,
    testThroughWeeks: testArchive.distinct,
  };
  // Rough 1/sqrt(n) style uncertainty marker for reporting — not a formal CI.
  const uncertainty = {
    testN: nTest != null ? nTest : Math.max(0, nEligible - (nTrain || 0)),
    note: "Report MAE/accuracy with sample n; treat small-n results as high-uncertainty research signals.",
    approxSeScale:
      (nTest != null ? nTest : nEligible) > 0
        ? Number((1 / Math.sqrt(nTest != null ? nTest : Math.max(nEligible, 1))).toFixed(4))
        : null,
  };

  const readyToAttemptFit = missing.length === 0;
  return {
    version: CORE_HISTORICAL_VERSION,
    model: "C_combined_champion_plus_core",
    eligibilityMode: "evidence_based",
    fixedThreeSeasonRequirement: false,
    readyToAttemptFit,
    policy,
    seasons: perSeason,
    sampleSize,
    uncertainty,
    verifiedHistoricalCutoffs: verifiedHistoricalCutoffs === true,
    validTrainTestSeparation: separationOk,
    verifiedOosArtifacts,
    missing,
    fitPolicy: {
      chronological: true,
      trainFoundationSeason: Number(trainSeason),
      evaluateSeason: Number(testSeason),
      trainOnOlderSeasonsOnly: true,
      evaluateOnUnseenLaterSeasons: true,
      metrics: ["marginMae", "winnerAccuracy", "totalMae", "calibration_brier"],
      compareAgainst: "champion_A_A_baseline_features",
      reportSampleSizeAndUncertainty: true,
      neverAutoPromote: true,
    },
    authenticityWarning:
      "Weekly training documents (2025+) and CFBD /ratings/core API records are distinct datasets. Keep source labels; refuse promotion claims that require unverified cutoffs or contemporaneous publication times.",
    authority: "research_only",
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

/**
 * Attempt Model C research eval only when readiness gate passes.
 * Otherwise return a blocked report — never fabricate OOS improvement.
 */
export function runModelCResearchIfReady(rows = [], readinessInput = {}, evalOpts = {}) {
  const readiness = assessModelCResearchReadiness(readinessInput);
  if (!readiness.readyToAttemptFit) {
    return {
      ok: false,
      blocked: true,
      reason: "model_c_corpus_not_ready",
      readiness,
      classification: "Unable to evaluate due to data limitations",
      authority: "research_only",
      canAuthorizeWager: false,
      canInfluenceProduction: false,
    };
  }
  const report = evaluateCfbCoreResearch(rows, evalOpts);
  return {
    ok: true,
    blocked: false,
    readiness,
    report,
    models: {
      A: "champion_baseline",
      B: "core_only",
      C: "combined",
    },
    authority: "research_only",
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}
