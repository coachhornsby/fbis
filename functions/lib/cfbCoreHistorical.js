/**
 * Historical CORE reconstruction from CFBD /ratings/core.
 *
 * CFBD returns stored weekly snapshots (throughWeek + throughSeasonType) for
 * seasons 2016–present when queried by year. Those historical values are
 * retrospective recalculations under the released methodology — not a ledger
 * of contemporaneous publications. FBIS must preserve every distinct
 * throughWeek and label authenticity honestly.
 *
 * Research-only. Never promotes champion A/A or authorizes wagers.
 */

import { normalizeCoreRating } from "./cfbdCanonical.js";
import {
  buildCoreWeeklyArchivePayload,
  persistCoreWeeklyArchive,
  CORE_RESEARCH_ONLY,
} from "./cfbCoreArchive.js";
import { CFB_CORE_ADVANCED_AUTHORITY } from "./cfbCoreAdvancedPlumbing.js";
import { evaluateCfbCoreResearch } from "./cfbCoreEvaluation.js";

export const CORE_HISTORICAL_VERSION = "cfb-core-historical-v1";
export const CORE_AUTHENTICITY = Object.freeze({
  /** Distinct throughWeek rows from CFBD year endpoint; methodology may be retrospective. */
  RETROSPECTIVE_CFBD_STORED: "retrospective_cfbd_stored",
  /** Captured live during the season with collection_time near that week. */
  CONTEMPORANEOUS_COLLECTION: "contemporaneous_collection",
  /** Budgeted label without a distinct CFBD throughWeek publish. */
  LABEL_ONLY_DUPLICATE: "label_only_duplicate",
  UNKNOWN: "unknown",
});

/**
 * CFBD product facts used for planning (no network).
 * Source: api.collegefootballdata.com/core-ratings + data-availability.
 */
export function describeCfbdCoreHistoricalAvailability() {
  return {
    version: CORE_HISTORICAL_VERSION,
    endpoint: "/ratings/core",
    query: { required: "year or team", optional: ["conference"] },
    returns: "TeamCoreRating[] including throughWeek, throughSeasonType, modelVersion",
    seasonCoverage: { first: 2016, through: "present" },
    weeklySnapshots: true,
    authenticity: {
      class: CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
      cfbdStatement:
        "Historical ratings are retrospective results from the released methodology rather than a record of what the model would have reported at that point in time.",
      implication:
        "throughWeek boundaries are authentic stored endpoints and must be preserved distinctly; do not treat reconstructed archives as contemporaneous publication timestamps unless collection_time proves live capture.",
    },
    researchOnly: CORE_RESEARCH_ONLY,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
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
 * Plan which seasons/weeks still need reconstruction given existing archives.
 */
export function planCoreHistoricalReconstruction({
  seasons = [2024, 2025, 2026],
  existingArchives = [],
  minThroughWeek = 1,
  maxThroughWeek = 15,
} = {}) {
  const bySeason = new Map();
  for (const row of existingArchives || []) {
    const s = Number(row.season ?? row.year);
    const tw = Number(row.through_week ?? row.throughWeek);
    if (!Number.isFinite(s) || !Number.isFinite(tw)) continue;
    if (!bySeason.has(s)) bySeason.set(s, new Set());
    bySeason.get(s).add(tw);
  }

  const plan = (seasons || []).map((season) => {
    const have = [...(bySeason.get(Number(season)) || [])].sort((a, b) => a - b);
    const expected = [];
    for (let w = minThroughWeek; w <= maxThroughWeek; w++) expected.push(w);
    // Current season may not have published all weeks yet — do not require future weeks.
    const missing = expected.filter((w) => !have.includes(w));
    return {
      season: Number(season),
      archivedThroughWeeks: have,
      distinctArchived: have.length,
      missingThroughWeeks: missing,
      action: missing.length
        ? "fetch_/ratings/core?year=SEASON_and_archive_each_distinct_throughWeek"
        : "complete",
    };
  });

  return {
    version: CORE_HISTORICAL_VERSION,
    availability: describeCfbdCoreHistoricalAvailability(),
    seasons: plan,
    totalDistinctArchives: plan.reduce((n, s) => n + s.distinctArchived, 0),
    nextSteps: [
      "Run authorized cfb-core-historical-reconstruct per season with CFBD entitlement",
      "Persist each distinct throughWeek via persistCoreWeeklyArchive (no collapsing)",
      "Label authenticity as retrospective_cfbd_stored unless contemporaneous collection_time exists",
      "Do not treat identical cross-week values as genuine performance movement",
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
 * Fit only when chronological multi-season PIT corpus is ready — never invent OOS wins.
 */
export function assessModelCResearchReadiness({
  archivesBySeason = {},
  eligiblePitGameRows = 0,
  verifiedOosArtifacts = 0,
  minSeasons = 3,
  minDistinctThroughWeeksPerSeason = 3,
  minEligibleRows = 200,
  minFolds = 2,
} = {}) {
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
  const seasonsWithDepth = perSeason.filter((s) => s.distinct >= minDistinctThroughWeeksPerSeason);
  const missing = [];
  if (seasonsWithDepth.length < minSeasons) {
    missing.push({
      code: "insufficient_season_throughweek_depth",
      have: perSeason,
      need: `≥${minSeasons} seasons each with ≥${minDistinctThroughWeeksPerSeason} distinct throughWeek archives`,
    });
  }
  if (!(eligiblePitGameRows >= minEligibleRows)) {
    missing.push({
      code: "insufficient_pit_game_rows",
      have: eligiblePitGameRows,
      need: `≥${minEligibleRows} chronological PIT rows (throughWeek < gameWeek, coreSourceAsOf < kickoff, verified finals)`,
    });
  }
  // verified OOS is an *output* of fitting — readiness to *attempt* fit does not require it yet.
  const readyToAttemptFit = missing.length === 0;
  return {
    version: CORE_HISTORICAL_VERSION,
    model: "C_combined_champion_plus_core",
    readyToAttemptFit,
    seasons: perSeason,
    seasonsWithDepth: seasonsWithDepth.length,
    eligiblePitGameRows,
    verifiedOosArtifacts,
    minFolds,
    missing,
    fitPolicy: {
      chronological: true,
      trainOnOlderSeasonsOnly: true,
      evaluateOnUnseenLaterSeasons: true,
      metrics: ["marginMae", "winnerAccuracy", "totalMae", "calibration_brier"],
      compareAgainst: "champion_A_A_baseline_features",
      neverAutoPromote: true,
    },
    authenticityWarning:
      "Retrospective CFBD weekly CORE is week-bounded but not contemporaneous; keep authenticityClass on archives and refuse promotion claims that require live PIT publication times.",
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
