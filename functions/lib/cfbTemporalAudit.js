/**
 * Historical temporal-source audit for CFB-FBIS-v2 and CFB-PLAYER-v1.
 * A PASS must prove actual source eligibility — never inferred maximum eligibility.
 */

import { CFBD_FEATURE_CATALOG, FEATURE_CATALOG_VERSION } from "./cfbdFeatureCatalog.js";
import { TEMPORAL_CLASS, temporalClassForFeature } from "./cfbFeaturePipeline.js";
import { filterGamesBeforeKickoff } from "./cfbFeatureStore.js";
import { ROLE_CONFIDENCE_TIERS, classifyRoleConfidence } from "./cfbPlayerIdentity.js";

export const TEMPORAL_AUDIT_VERSION = "cfb-temporal-audit-v2";

export const HISTORICALLY_UNSAFE_ENDPOINTS = Object.freeze([
  "/stats/season/advanced",
  "/ppa/players/season",
  "/player/usage",
  "/stats/player/season",
  "/ppa/teams",
]);

export const PRIOR_ONLY_SAME_SEASON_ENDPOINTS = Object.freeze([
  "/ratings/sp",
  "/ratings/fpi",
  "/ratings/srs",
  "/ratings/elo",
]);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(v) {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function latestAllowedWeekForTarget(targetWeek, { includeCurrentWeek = false } = {}) {
  if (targetWeek == null || !Number.isFinite(Number(targetWeek))) return null;
  return Math.max(0, Number(targetWeek) - (includeCurrentWeek ? 0 : 1));
}

/**
 * Assert every source observation kickoff is strictly before the target kickoff.
 * Does NOT accept week labels as proof — kickoff timestamps required.
 */
export function assertSourceObservationsBeforeKickoff({
  targetKickoffTimestamp,
  targetPredictionCutoff = null,
  observations = [],
} = {}) {
  const targetKick = Date.parse(targetKickoffTimestamp || "");
  const cutoff = targetPredictionCutoff
    ? Date.parse(targetPredictionCutoff)
    : Number.isFinite(targetKick)
      ? targetKick - 60_000
      : NaN;
  const errors = [];
  const accepted = [];
  const rejected = [];

  if (!Number.isFinite(targetKick)) errors.push("target-kickoff-missing");
  if (!Number.isFinite(cutoff)) errors.push("prediction-cutoff-missing");

  for (const obs of observations || []) {
    const sourceKick = Date.parse(obs.sourceKickoffTimestamp || obs.startDate || obs.start_date || obs.kickoff || "");
    const row = {
      sourceGameId: obs.sourceGameId ?? obs.gameId ?? obs.game_id ?? null,
      sourceKickoffTimestamp: isoOrNull(obs.sourceKickoffTimestamp || obs.startDate || obs.start_date || obs.kickoff),
      sourceSeason: obs.sourceSeason ?? obs.season ?? obs.year ?? null,
      sourceWeek: obs.sourceWeek ?? obs.week ?? null,
      endpoint: obs.endpoint || null,
      labeledWeek: obs.week ?? obs.sourceWeek ?? null,
    };
    if (!Number.isFinite(sourceKick)) {
      rejected.push({ ...row, reason: "missing-source-kickoff-timestamp" });
      errors.push("missing-source-kickoff-timestamp");
      continue;
    }
    // Reject even if metadata claims an earlier week
    if (sourceKick >= targetKick) {
      rejected.push({
        ...row,
        reason: "source-kickoff-on-or-after-target",
        labeledWeek: row.labeledWeek,
      });
      errors.push("source-kickoff-on-or-after-target");
      continue;
    }
    if (Number.isFinite(cutoff) && sourceKick > cutoff) {
      // Source after constructed cutoff but before kickoff still unsafe for freeze-at-cutoff
      rejected.push({ ...row, reason: "source-kickoff-after-prediction-cutoff" });
      errors.push("source-kickoff-after-prediction-cutoff");
      continue;
    }
    accepted.push(row);
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    accepted,
    rejected,
    targetKickoffTimestamp: isoOrNull(targetKickoffTimestamp),
    targetPredictionCutoff: isoOrNull(targetPredictionCutoff) || (Number.isFinite(cutoff) ? new Date(cutoff).toISOString() : null),
    actualSourceWeeks: [...new Set(accepted.map((a) => a.sourceWeek).filter((w) => w != null))],
    sourceGameIds: accepted.map((a) => a.sourceGameId).filter(Boolean),
  };
}

/**
 * CORE provenance from the actual retrieved row — never substitute targetWeek-1.
 */
export function auditCoreProvenance({
  coreRow = null,
  targetWeek = null,
  targetKickoffTimestamp = null,
  priorSeasonFreeze = false,
  expectedPriorSeason = null,
} = {}) {
  const latestAllowedWeek = latestAllowedWeekForTarget(targetWeek);
  if (priorSeasonFreeze) {
    const year = num(coreRow?.year ?? coreRow?.season);
    const ok = year != null && expectedPriorSeason != null && year === Number(expectedPriorSeason);
    return {
      ok,
      eligibleForIndependentProjection: ok,
      year: year,
      throughWeek: num(coreRow?.throughWeek),
      throughSeasonType: coreRow?.throughSeasonType || coreRow?.seasonType || null,
      latestAllowedWeek,
      actualThroughWeek: num(coreRow?.throughWeek),
      priorSeasonFreeze: true,
      exclusionReason: ok ? null : "core-prior-season-mismatch-or-missing",
    };
  }
  if (!coreRow) {
    return {
      ok: false,
      eligibleForIndependentProjection: false,
      year: null,
      throughWeek: null,
      throughSeasonType: null,
      latestAllowedWeek,
      actualThroughWeek: null,
      exclusionReason: "core-row-missing",
    };
  }
  const throughWeek = num(coreRow.throughWeek ?? coreRow.week);
  const year = num(coreRow.year ?? coreRow.season);
  const throughSeasonType = coreRow.throughSeasonType || coreRow.seasonType || null;
  let ok = true;
  let exclusionReason = null;
  if (throughWeek == null) {
    ok = false;
    exclusionReason = "core-missing-throughWeek";
  } else if (latestAllowedWeek != null && throughWeek > latestAllowedWeek) {
    ok = false;
    exclusionReason = `core-throughWeek-${throughWeek}-gt-latestAllowedWeek-${latestAllowedWeek}`;
  } else if (latestAllowedWeek != null && throughWeek >= Number(targetWeek)) {
    ok = false;
    exclusionReason = `core-throughWeek-${throughWeek}-gte-targetWeek-${targetWeek}`;
  }
  return {
    ok,
    eligibleForIndependentProjection: ok,
    year,
    throughWeek,
    throughSeasonType,
    latestAllowedWeek,
    actualThroughWeek: throughWeek,
    targetKickoffTimestamp: isoOrNull(targetKickoffTimestamp),
    rating: num(coreRow.rating ?? coreRow.overall),
    exclusionReason,
  };
}

/**
 * Provenance for a reconstructed rolling feature — contaminated source fails the feature.
 */
export function auditReconstructedFeatureProvenance({
  featureName,
  endpoint,
  targetKickoffTimestamp,
  targetPredictionCutoff = null,
  targetWeek = null,
  observations = [],
  requireAtLeastOne = false,
} = {}) {
  const check = assertSourceObservationsBeforeKickoff({
    targetKickoffTimestamp,
    targetPredictionCutoff,
    observations: (observations || []).map((o) => ({ ...o, endpoint: o.endpoint || endpoint })),
  });
  let ok = check.ok;
  let exclusionReason = check.ok ? null : check.errors.join(",");
  if (requireAtLeastOne && check.accepted.length === 0) {
    ok = false;
    exclusionReason = exclusionReason || "no-pre-kickoff-source-observations";
  }
  // One contaminated source fails the whole reconstructed feature
  if (check.rejected.length > 0) {
    ok = false;
    exclusionReason = `contaminated-source:${check.rejected.map((r) => r.reason).join("|")}`;
  }
  return {
    featureName,
    endpoint,
    ok,
    eligibleForIndependentProjection: ok,
    exclusionReason,
    latestAllowedWeek: latestAllowedWeekForTarget(targetWeek),
    actualSourceWeeks: check.actualSourceWeeks,
    sourceGameIds: check.sourceGameIds,
    sourceObservations: check.accepted,
    rejectedObservations: check.rejected,
    targetKickoffTimestamp: check.targetKickoffTimestamp,
    targetPredictionCutoff: check.targetPredictionCutoff,
    temporalClass: TEMPORAL_CLASS.C,
  };
}

/**
 * Classify one catalog feature. Eligibility requires actual provenance when reconstructed/CORE/prior.
 */
export function auditFeatureForCutoff(feature, ctx = {}) {
  const {
    year = null,
    seasonType = "regular",
    targetWeek = null,
    kickoffTimestamp = null,
    predictionCutoff = null,
    throughWeek = null, // actual CORE throughWeek when known
    sourceWeek = null, // actual source week(s) — never invent targetWeek-1
    sourceGameIds = null,
    sourceSeason = null,
    actualSourceWeeks = null,
    reconstructedFromGames = false,
    priorSeasonFreeze = false,
    evaluationOnly = false,
    sourceObservations = null,
    coreRow = null,
  } = ctx;

  const temporalClass = feature.temporalClass || temporalClassForFeature(feature);
  const endpoint = feature.endpoint;
  const cutoff =
    predictionCutoff || (kickoffTimestamp ? new Date(Date.parse(kickoffTimestamp) - 60_000).toISOString() : null);
  const latestAllowedWeek = latestAllowedWeekForTarget(targetWeek);

  let eligible = true;
  let exclusionReason = null;
  let resolvedClass = temporalClass;
  let coreProvenance = null;
  let reconstructionProvenance = null;

  if (evaluationOnly || feature.use === "evaluation" || temporalClass === TEMPORAL_CLASS.E) {
    eligible = false;
    exclusionReason = "evaluation-only";
    resolvedClass = TEMPORAL_CLASS.E;
  } else if (HISTORICALLY_UNSAFE_ENDPOINTS.includes(endpoint) && !reconstructedFromGames && !priorSeasonFreeze) {
    eligible = false;
    exclusionReason = "same-season-aggregate-without-game-reconstruction";
    resolvedClass = TEMPORAL_CLASS.D;
  } else if (PRIOR_ONLY_SAME_SEASON_ENDPOINTS.includes(endpoint) && !priorSeasonFreeze) {
    eligible = false;
    exclusionReason = "undated-same-season-rating-aggregate";
    resolvedClass = TEMPORAL_CLASS.D;
  } else if (PRIOR_ONLY_SAME_SEASON_ENDPOINTS.includes(endpoint) && priorSeasonFreeze) {
    if (sourceSeason == null) {
      eligible = false;
      exclusionReason = "missing-source-provenance";
    } else if (ctx.expectedPriorSeason != null && Number(sourceSeason) !== Number(ctx.expectedPriorSeason)) {
      eligible = false;
      exclusionReason = "prior-source-season-mismatch";
    } else {
      eligible = true;
      resolvedClass = TEMPORAL_CLASS.A;
    }
  } else if (endpoint === "/ratings/core") {
    coreProvenance = auditCoreProvenance({
      coreRow: coreRow || (throughWeek != null ? { throughWeek, year, throughSeasonType: seasonType } : null),
      targetWeek,
      targetKickoffTimestamp: kickoffTimestamp,
      priorSeasonFreeze,
      expectedPriorSeason: ctx.expectedPriorSeason,
    });
    eligible = coreProvenance.eligibleForIndependentProjection;
    exclusionReason = coreProvenance.exclusionReason;
    resolvedClass = priorSeasonFreeze ? TEMPORAL_CLASS.A : TEMPORAL_CLASS.B;
  } else if (reconstructedFromGames) {
    if (sourceObservations) {
      reconstructionProvenance = auditReconstructedFeatureProvenance({
        featureName: feature.canonical,
        endpoint,
        targetKickoffTimestamp: kickoffTimestamp,
        targetPredictionCutoff: cutoff,
        targetWeek,
        observations: sourceObservations,
      });
      eligible = reconstructionProvenance.ok;
      exclusionReason = reconstructionProvenance.exclusionReason;
    } else if (!sourceGameIds || !sourceGameIds.length) {
      // Catalog-level: reconstruction path is allowed in principle, but no actual sources yet
      eligible = true;
      resolvedClass = TEMPORAL_CLASS.C;
      exclusionReason = null;
    } else {
      eligible = true;
      resolvedClass = TEMPORAL_CLASS.C;
    }
    resolvedClass = TEMPORAL_CLASS.C;
  } else if (priorSeasonFreeze) {
    if (sourceSeason == null) {
      eligible = false;
      exclusionReason = "missing-source-provenance";
    } else {
      eligible = true;
      resolvedClass = TEMPORAL_CLASS.A;
    }
  } else if (temporalClass === TEMPORAL_CLASS.D) {
    eligible = false;
    exclusionReason = "class-D-unsafe-without-dated-snapshot";
  } else if (temporalClass === TEMPORAL_CLASS.C && !reconstructedFromGames) {
    eligible = false;
    exclusionReason = "class-C-requires-game-play-reconstruction";
  }

  const actualWeeks =
    actualSourceWeeks ||
    reconstructionProvenance?.actualSourceWeeks ||
    (sourceWeek != null ? [sourceWeek] : null);

  return {
    featureName: feature.canonical,
    group: feature.group,
    endpoint,
    rawSource: feature.rawFields,
    temporalClass: resolvedClass,
    catalogClass: temporalClass,
    year,
    seasonType,
    // Separated fields — do not conflate allowance with consumption
    latestAllowedWeek,
    actualSourceWeeks: actualWeeks,
    sourceWeek: sourceWeek ?? null, // only when actual
    throughWeek: coreProvenance?.actualThroughWeek ?? throughWeek ?? null,
    sourceGameIds: reconstructionProvenance?.sourceGameIds || sourceGameIds || null,
    sourceSeason: sourceSeason ?? null,
    predictionCutoff: cutoff,
    latestInformationTimestampAllowed: cutoff,
    kickoffTimestamp: isoOrNull(kickoffTimestamp),
    eligibleForIndependentProjection: eligible,
    exclusionReason,
    priorSeasonFreeze: Boolean(priorSeasonFreeze),
    reconstructedFromGames: Boolean(reconstructedFromGames),
    evaluationOnly: Boolean(evaluationOnly || feature.use === "evaluation"),
    coreProvenance,
    reconstructionProvenance,
    provisionalWeightsNote:
      feature.use === "prior"
        ? "SP.35/CORE.25/FPI.20/SRS.12/Elo.08 and n/(n+6) are provisional — not fitted"
        : null,
  };
}

export function auditCatalogForGame(ctx = {}) {
  const rows = CFBD_FEATURE_CATALOG.map((f) => {
    const endpoint = f.endpoint;
    const isPriorRating = PRIOR_ONLY_SAME_SEASON_ENDPOINTS.includes(endpoint);
    const isCore = endpoint === "/ratings/core";
    const isGameGrain = f.grain === "game" || endpoint === "/ppa/games" || endpoint === "/stats/game/advanced";
    const isPersonnelPrior = f.use === "prior" && !isPriorRating && !isCore && endpoint !== "internal";

    return auditFeatureForCutoff(f, {
      ...ctx,
      priorSeasonFreeze: isPriorRating || isPersonnelPrior || (isCore && ctx.corePriorSeason),
      reconstructedFromGames: isGameGrain,
      evaluationOnly: f.use === "evaluation",
      // Do NOT pass targetWeek-1 as throughWeek — only actual CORE row
      throughWeek: isCore ? ctx.coreThroughWeek ?? null : null,
      coreRow: isCore ? ctx.coreRow ?? null : null,
      sourceSeason:
        isPriorRating || isPersonnelPrior || ctx.corePriorSeason
          ? ctx.priorSourceSeason ?? null
          : null,
      expectedPriorSeason: ctx.priorSeason ?? (ctx.year != null ? Number(ctx.year) - 1 : null),
    });
  });

  const rejected = rows.filter((r) => !r.eligibleForIndependentProjection);
  const eligible = rows.filter((r) => r.eligibleForIndependentProjection);

  return {
    auditVersion: TEMPORAL_AUDIT_VERSION,
    catalogVersion: FEATURE_CATALOG_VERSION,
    context: {
      year: ctx.year ?? null,
      targetWeek: ctx.targetWeek ?? null,
      seasonType: ctx.seasonType || "regular",
      kickoffTimestamp: ctx.kickoffTimestamp ?? null,
      predictionCutoff: ctx.predictionCutoff ?? null,
      priorSeason: ctx.priorSeason ?? (ctx.year != null ? Number(ctx.year) - 1 : null),
      latestAllowedWeek: latestAllowedWeekForTarget(ctx.targetWeek),
      coreThroughWeekActual: ctx.coreThroughWeek ?? null,
    },
    summary: {
      total: rows.length,
      eligible: eligible.length,
      rejected: rejected.length,
      rejectedByEndpoint: summarizeRejectedByEndpoint(rejected),
      historicallyUnsafeEndpoints: [...HISTORICALLY_UNSAFE_ENDPOINTS],
      priorOnlySameSeasonEndpoints: [...PRIOR_ONLY_SAME_SEASON_ENDPOINTS],
    },
    features: rows,
  };
}

function summarizeRejectedByEndpoint(rejected) {
  const out = {};
  for (const r of rejected) {
    const key = `${r.endpoint}::${r.exclusionReason}`;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/**
 * Fail closed: missing sourceSeason does NOT default to expected prior season.
 */
export function auditPreseasonPriorSources({
  gameYear,
  priorCatalogEntry = null,
  priorSeason = null,
} = {}) {
  const expectedPrior = priorSeason ?? (gameYear != null ? Number(gameYear) - 1 : null);
  const entry = priorCatalogEntry && typeof priorCatalogEntry === "object" ? priorCatalogEntry : null;
  const explicitSource =
    entry && Object.prototype.hasOwnProperty.call(entry, "sourceSeason") ? entry.sourceSeason : undefined;

  if (entry == null) {
    return {
      ok: false,
      gameYear,
      expectedPriorSeason: expectedPrior,
      sourceSeason: null,
      consumedPriorSeason: null,
      leakageIfCurrentSeasonFinals: false,
      provisionalWeights: { sp: 0.35, core: 0.25, fpi: 0.2, srs: 0.12, elo: 0.08, note: "provisional-unfitted" },
      shrinkBenchmark: { formula: "n/(n+6)", note: "provisional until OOS supports" },
      priorBlendHash: null,
      sources: null,
      exclusionReason: "missing-source-provenance",
    };
  }

  if (explicitSource == null || explicitSource === "") {
    return {
      ok: false,
      gameYear,
      expectedPriorSeason: expectedPrior,
      sourceSeason: null,
      consumedPriorSeason: null,
      leakageIfCurrentSeasonFinals: false,
      provisionalWeights: { sp: 0.35, core: 0.25, fpi: 0.2, srs: 0.12, elo: 0.08, note: "provisional-unfitted" },
      shrinkBenchmark: { formula: "n/(n+6)", note: "provisional until OOS supports" },
      priorBlendHash: entry.artifactHash || entry.priorBlend?.hash || null,
      sources: null,
      exclusionReason: "missing-source-provenance",
    };
  }

  const sourceSeason = Number(explicitSource);
  const ok = Number.isFinite(sourceSeason) && expectedPrior != null && sourceSeason === Number(expectedPrior);
  const currentSeasonLeak = Number.isFinite(sourceSeason) && gameYear != null && sourceSeason === Number(gameYear);

  const sources = {
    sp: { season: sourceSeason, value: entry.spOverall ?? null, endpoint: "/ratings/sp" },
    core: { season: sourceSeason, value: entry.coreOverall ?? null, endpoint: "/ratings/core" },
    fpi: { season: sourceSeason, value: entry.fpi ?? null, endpoint: "/ratings/fpi" },
    srs: { season: sourceSeason, value: entry.srs ?? null, endpoint: "/ratings/srs" },
    elo: { season: sourceSeason, value: entry.elo ?? null, endpoint: "/ratings/elo" },
    talent: { season: sourceSeason, value: entry.talent ?? null, endpoint: "/talent" },
    returning: { season: sourceSeason, value: entry.returningPct ?? null, endpoint: "/player/returning" },
    recruiting: { season: sourceSeason, value: entry.recruitingPoints ?? null, endpoint: "/recruiting/teams" },
    portal: { season: sourceSeason, value: null, endpoint: "/player/portal", note: "identity/continuity only" },
    coaching: { season: sourceSeason, value: null, endpoint: "/coaches", note: "hire/tenure continuity" },
  };

  return {
    ok,
    gameYear,
    expectedPriorSeason: expectedPrior,
    sourceSeason: Number.isFinite(sourceSeason) ? sourceSeason : null,
    consumedPriorSeason: Number.isFinite(sourceSeason) ? sourceSeason : null,
    leakageIfCurrentSeasonFinals: Boolean(currentSeasonLeak),
    provisionalWeights: { sp: 0.35, core: 0.25, fpi: 0.2, srs: 0.12, elo: 0.08, note: "provisional-unfitted" },
    shrinkBenchmark: { formula: "n/(n+6)", note: "provisional until OOS supports" },
    priorBlendHash: entry.artifactHash || entry.priorBlend?.hash || null,
    sources,
    exclusionReason: ok
      ? null
      : currentSeasonLeak
        ? "current-season-prior-data-when-prior-season-required"
        : "prior-source-season-mismatch-or-missing",
  };
}

/**
 * Build machine-readable provenance for features actually passed to the model.
 */
export function buildModelInputProvenance({
  game = {},
  featureRecord = null,
  roles = null,
  mode = "historical",
  priorAudits = null,
} = {}) {
  const kickoff = game.startDate || game.start_date || game.kickoff || featureRecord?.kickoff_timestamp;
  const week = game.week ?? featureRecord?.week;
  const year = game.season || game.year || featureRecord?.season;
  const cutoff =
    featureRecord?.feature_cutoff_timestamp ||
    (kickoff ? new Date(Date.parse(kickoff) - 60_000).toISOString() : null);
  const latestAllowedWeek = latestAllowedWeekForTarget(week);

  const home = featureRecord?.features?.home || {};
  const away = featureRecord?.features?.away || {};

  const passed = [];
  const rejected = [];
  let provenancePass = true;

  const pushReconstructed = (side, feat, name, value, endpoint) => {
    const obs = feat.sourceObservations || feat.rollingSourceObservations || [];
    const audit = auditReconstructedFeatureProvenance({
      featureName: `${side}.${name}`,
      endpoint,
      targetKickoffTimestamp: kickoff,
      targetPredictionCutoff: cutoff,
      targetWeek: week,
      observations: obs,
      requireAtLeastOne: value != null,
    });
    const row = {
      featureName: `${side}.${name}`,
      value: value ?? null,
      endpoint,
      temporalClass: "C",
      year,
      latestAllowedWeek,
      actualSourceWeeks: audit.actualSourceWeeks,
      sourceWeek: null,
      throughWeek: null,
      sourceGameIds: audit.sourceGameIds,
      sourceObservations: audit.sourceObservations,
      predictionCutoff: cutoff,
      eligibleForIndependentProjection: audit.ok && value != null,
      exclusionReason: !audit.ok ? audit.exclusionReason : value == null ? "missing-value" : null,
    };
    // Contaminated / post-cutoff / present-without-sources fail provenance. Absent values do not.
    if (!audit.ok) {
      provenancePass = false;
      rejected.push(row);
    } else if (value == null) {
      rejected.push(row);
    } else {
      passed.push(row);
    }
  };

  const pushPrior = (side, feat, name, value, endpoint, priorAudit) => {
    const sourceSeason = priorAudit?.sourceSeason ?? feat.priorSourceSeason ?? null;
    const okPrior = priorAudit?.ok === true && sourceSeason != null;
    const row = {
      featureName: `${side}.${name}`,
      value: value ?? null,
      endpoint,
      temporalClass: "A",
      year,
      latestAllowedWeek,
      actualSourceWeeks: null,
      sourceWeek: null,
      throughWeek: null,
      sourceSeason,
      sourceGameIds: null,
      predictionCutoff: cutoff,
      eligibleForIndependentProjection: okPrior && value != null,
      exclusionReason: !okPrior
        ? priorAudit?.exclusionReason || "missing-source-provenance"
        : value == null
          ? "missing-value"
          : null,
    };
    // Bad/missing prior provenance fails. Absent prior values with valid prior audit do not.
    if (!okPrior) {
      provenancePass = false;
      rejected.push(row);
    } else if (value == null) {
      rejected.push(row);
    } else {
      passed.push(row);
    }
  };

  const pushCore = (side, feat) => {
    const coreRow = feat.coreRow || {
      year: feat.coreYear,
      throughWeek: feat.coreThroughWeek,
      throughSeasonType: feat.coreThroughSeasonType,
      rating: feat.coreRating,
    };
    const audit = auditCoreProvenance({
      coreRow: feat.coreThroughWeek != null || feat.coreRow ? coreRow : null,
      targetWeek: week,
      targetKickoffTimestamp: kickoff,
    });
    const row = {
      featureName: `${side}.core`,
      value: feat.coreRating ?? null,
      endpoint: "/ratings/core",
      temporalClass: "B",
      year: audit.year,
      latestAllowedWeek: audit.latestAllowedWeek,
      actualSourceWeeks: null,
      sourceWeek: null,
      throughWeek: audit.actualThroughWeek,
      throughSeasonType: audit.throughSeasonType,
      sourceGameIds: null,
      predictionCutoff: cutoff,
      eligibleForIndependentProjection: audit.ok,
      exclusionReason: audit.exclusionReason,
      coreProvenance: audit,
    };
    // Missing CORE is allowed as absent (not a pass of invented week) — mark rejected only if present but invalid
    if (feat.coreThroughWeek != null || feat.coreRating != null) {
      if (!row.eligibleForIndependentProjection) {
        provenancePass = false;
        rejected.push(row);
      } else {
        passed.push(row);
      }
    }
  };

  for (const side of ["home", "away"]) {
    const feat = side === "home" ? home : away;
    const priorAudit = priorAudits?.[side] || null;
    pushPrior(side, feat, "priorOff", feat.priorOff, "/ratings/sp", priorAudit);
    pushPrior(side, feat, "priorDef", feat.priorDef, "/ratings/sp", priorAudit);
    pushCore(side, feat);
    pushReconstructed(side, feat, "passEpa", feat.passEpa, "/ppa/games");
    pushReconstructed(side, feat, "rushEpa", feat.rushEpa, "/ppa/games");
    pushReconstructed(side, feat, "successRate", feat.successRate, "/stats/game/advanced");
    pushReconstructed(side, feat, "explosiveRate", feat.explosiveRate, "/stats/game/advanced");
    pushReconstructed(side, feat, "havocRate", feat.havocRate, "/stats/game/advanced");
    pushReconstructed(side, feat, "lineYards", feat.lineYards, "/stats/game/advanced");
    pushReconstructed(side, feat, "pointsPerOpportunity", feat.pointsPerOpportunity, "/stats/game/advanced");

    if (feat.qbHistoricalUnsafe || (mode === "historical" && feat.qbSourceEndpoint === "/ppa/players/season")) {
      const unsafeValue = feat.qbPpa;
      rejected.push({
        featureName: `${side}.qbPpa`,
        value: unsafeValue ?? null,
        endpoint: "/ppa/players/season",
        temporalClass: "D",
        latestAllowedWeek,
        eligibleForIndependentProjection: false,
        exclusionReason: "season-qb-ppa-unsafe-for-historical",
      });
      // Correctly excluding unsafe season aggregates must not fail provenance.
      // Only fail if an unsafe value was still present for independent use.
      if (unsafeValue != null) provenancePass = false;
    } else if (feat.qbPpa != null && feat.reconstructedFromGames) {
      pushReconstructed(side, feat, "qbPpa", feat.qbPpa, feat.qbSourceEndpoint || "/ppa/players/games");
    }
  }

  const evalBlock = featureRecord?.features?.evaluation || {};
  for (const [k, v] of Object.entries(evalBlock)) {
    rejected.push({
      featureName: `evaluation.${k}`,
      value: v,
      endpoint: "/lines",
      temporalClass: "E",
      year,
      predictionCutoff: cutoff,
      latestAllowedWeek,
      eligibleForIndependentProjection: false,
      exclusionReason: "evaluation-only",
    });
  }

  return {
    auditVersion: TEMPORAL_AUDIT_VERSION,
    mode,
    gameId: String(game.id || game.gameId || featureRecord?.game_id || ""),
    season: year,
    week,
    kickoffTimestamp: kickoff,
    predictionCutoff: cutoff,
    latestAllowedWeek,
    homeTeam: featureRecord?.home_team || game.homeTeam || game.home?.name,
    awayTeam: featureRecord?.away_team || game.awayTeam || game.away?.name,
    modelDataVersion: featureRecord?.source_version || null,
    provenancePass,
    independentFeaturesPassed: passed,
    featuresRejected: rejected,
    roles: roles || null,
    targetsSeparated: true,
    note: "Actual source observations only — latestAllowedWeek is not a substitute for actualSourceWeeks",
  };
}

export function rejectPostCutoffObservations(rows = [], kickoffTimestamp) {
  const kick = Date.parse(kickoffTimestamp || "");
  const kept = [];
  const rejected = [];
  for (const row of rows || []) {
    const start = Date.parse(row.startDate || row.start_date || row.kickoff || "");
    if (!Number.isFinite(kick) || !Number.isFinite(start) || start >= kick) {
      rejected.push({
        reason: !Number.isFinite(start) ? "missing-or-undated-observation" : "on-or-after-kickoff",
        startDate: row.startDate || row.start_date || null,
        gameId: row.gameId || row.game_id || null,
        labeledWeek: row.week ?? null,
      });
      continue;
    }
    kept.push(row);
  }
  return { kept, rejected, filter: filterGamesBeforeKickoff };
}

export function auditPlayerRoleResolution(roleRow = {}, extra = {}) {
  const conf = num(roleRow.role_confidence) ?? 0;
  const tier = classifyRoleConfidence(conf, roleRow.state);
  const priorGames = extra.priorGameRows || roleRow.selection?.priorGames || [];
  return {
    player: roleRow.player_name || null,
    player_id: roleRow.player_id || null,
    team: roleRow.team || null,
    position: roleRow.position || null,
    role: roleRow.role || null,
    priorStarts: extra.priorStarts ?? null,
    recentGameUsage: roleRow.selection?.sources || null,
    priorSeasonRole: extra.priorSeasonRole ?? null,
    currentSeasonPregameUsage: roleRow.selection || null,
    transferOrNewPlayer: extra.transfer ?? null,
    roleConfidence: conf,
    roleConfidenceTier: ROLE_CONFIDENCE_TIERS,
    roleConfidenceTierAssigned: tier,
    selectionReason: roleRow.selection?.method || roleRow.state || null,
    selectionMethod: roleRow.selection?.method || null,
    state: roleRow.state || null,
    widensUncertainty:
      Boolean(roleRow.provenance?.widenUncertainty) ||
      tier === "LOW" ||
      String(roleRow.state || "").includes("UNCERTAIN"),
    futureEvidenceUsed: false,
    actualPriorGameRowsConsumed: priorGames.length,
    sourceGameIds: priorGames.map((g) => g.gameId || g.game_id).filter(Boolean),
    sourceKickoffTimestamps: priorGames
      .map((g) => isoOrNull(g.startDate || g.start_date || g.kickoff))
      .filter(Boolean),
  };
}

export function historicallyRejectedEndpointReport() {
  return {
    auditVersion: TEMPORAL_AUDIT_VERSION,
    rejectedForHistoricalIndependentUse: HISTORICALLY_UNSAFE_ENDPOINTS.map((endpoint) => ({
      endpoint,
      reason: "same-season cumulative aggregate cannot prove cutoff bound",
      requiredAlternative:
        endpoint === "/ppa/teams"
          ? "reconstruct from /ppa/games before kickoff"
          : endpoint === "/stats/season/advanced"
            ? "reconstruct from /stats/game/advanced before kickoff"
            : "reconstruct from player-game rows before kickoff",
      temporalClassIfUnreconstructed: "D",
    })),
    undatedSameSeasonRatingsExcluded: PRIOR_ONLY_SAME_SEASON_ENDPOINTS.map((endpoint) => ({
      endpoint,
      reason: "undated same-season aggregate — prior-season freeze only",
    })),
    coreRule: "CORE passes only when actual row throughWeek <= latestAllowedWeek (= targetWeek-1)",
    provisionalNotes: {
      priorWeights: "SP.35 CORE.25 FPI.20 SRS.12 Elo.08 — provisional",
      shrink: "n/(n+6) — provisional",
    },
  };
}

export function backfillRequestEstimate({
  seasons = [2022, 2023, 2024, 2025],
  weeksPerSeason = 15,
  smokeWeeks = null,
} = {}) {
  const weeks = smokeWeeks != null ? smokeWeeks : weeksPerSeason;
  const seasonCount = seasons.length;
  const priorPaths = 11;
  const perWeekPaths = 2;
  const seasonFixed = 2;
  const perSeason = priorPaths + seasonFixed + weeks * perWeekPaths;
  return {
    seasons,
    weeksPerSeason: weeks,
    mode: smokeWeeks != null ? "smoke" : "full",
    estimate: seasonCount * perSeason,
    breakdown: {
      priorSeasonBundles: seasonCount * priorPaths,
      seasonFixed,
      weeklyGameGrain: seasonCount * weeks * perWeekPaths,
    },
    note: "Game-grain reconstruction only; player-game reconstruction adds more",
    customerPageFanout: 0,
  };
}
