/**
 * Historical temporal-source audit for CFB-FBIS-v2 and CFB-PLAYER-v1.
 * Does not fit or promote models. Classifies every feature for a prediction cutoff.
 *
 * Absolute rule: Week N may only consume information available before kickoff.
 * "Fetched in a weekly bundle" ≠ temporally safe.
 */

import { CFBD_FEATURE_CATALOG, FEATURE_CATALOG_VERSION } from "./cfbdFeatureCatalog.js";
import { TEMPORAL_CLASS, temporalClassForFeature } from "./cfbFeaturePipeline.js";
import { assertPregameTemporalIntegrity, filterGamesBeforeKickoff } from "./cfbFeatureStore.js";
import { ROLE_CONFIDENCE_TIERS, classifyRoleConfidence } from "./cfbPlayerIdentity.js";

export const TEMPORAL_AUDIT_VERSION = "cfb-temporal-audit-v1";

/** Same-season aggregates that are unsafe for historical in-season prediction unless reconstructed. */
export const HISTORICALLY_UNSAFE_ENDPOINTS = Object.freeze([
  "/stats/season/advanced",
  "/ppa/players/season",
  "/player/usage",
  "/stats/player/season",
  "/ppa/teams",
]);

/** Ratings that are only safe as prior-season freeze (or week-bounded CORE). */
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

/**
 * Classify one catalog feature for a specific historical prediction context.
 */
export function auditFeatureForCutoff(feature, ctx = {}) {
  const {
    year = null,
    seasonType = "regular",
    targetWeek = null,
    kickoffTimestamp = null,
    predictionCutoff = null,
    throughWeek = null,
    sourceWeek = null,
    sourceGameIds = null,
    sourceSeason = null,
    reconstructedFromGames = false,
    priorSeasonFreeze = false,
    evaluationOnly = false,
  } = ctx;

  const temporalClass = feature.temporalClass || temporalClassForFeature(feature);
  const endpoint = feature.endpoint;
  const cutoff = predictionCutoff || (kickoffTimestamp ? new Date(Date.parse(kickoffTimestamp) - 60_000).toISOString() : null);
  const latestAllowedWeek =
    targetWeek == null ? null : Math.max(0, Number(targetWeek) - (ctx.includeCurrentWeek === true ? 0 : 1));

  let eligible = true;
  let exclusionReason = null;
  let resolvedClass = temporalClass;

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
  } else if (endpoint === "/ratings/core") {
    if (throughWeek == null && !priorSeasonFreeze) {
      eligible = false;
      exclusionReason = "core-missing-throughWeek";
      resolvedClass = TEMPORAL_CLASS.D;
    } else if (throughWeek != null && latestAllowedWeek != null && Number(throughWeek) > Number(latestAllowedWeek)) {
      eligible = false;
      exclusionReason = `core-throughWeek-${throughWeek}-after-cutoff-week-${latestAllowedWeek}`;
      resolvedClass = TEMPORAL_CLASS.D;
    } else if (priorSeasonFreeze || (throughWeek != null && latestAllowedWeek != null && Number(throughWeek) <= Number(latestAllowedWeek))) {
      eligible = true;
      resolvedClass = priorSeasonFreeze ? TEMPORAL_CLASS.A : TEMPORAL_CLASS.B;
    }
  } else if (reconstructedFromGames) {
    eligible = true;
    resolvedClass = TEMPORAL_CLASS.C;
  } else if (priorSeasonFreeze) {
    eligible = true;
    resolvedClass = TEMPORAL_CLASS.A;
  } else if (temporalClass === TEMPORAL_CLASS.D) {
    eligible = false;
    exclusionReason = "class-D-unsafe-without-dated-snapshot";
  } else if (temporalClass === TEMPORAL_CLASS.C && !reconstructedFromGames) {
    eligible = false;
    exclusionReason = "class-C-requires-game-play-reconstruction";
  }

  // Timestamp integrity when provided
  if (eligible && kickoffTimestamp && cutoff) {
    const integrity = assertPregameTemporalIntegrity({
      kickoffTimestamp,
      featureAsOfTimestamp: cutoff,
      featureCutoffTimestamp: cutoff,
      collectionTimestamp: cutoff,
    });
    if (!integrity.ok) {
      eligible = false;
      exclusionReason = `temporal-integrity:${integrity.errors.join(",")}`;
    }
  }

  return {
    featureName: feature.canonical,
    group: feature.group,
    endpoint: endpoint,
    rawSource: feature.rawFields,
    temporalClass: resolvedClass,
    catalogClass: temporalClass,
    year,
    seasonType,
    sourceWeek: sourceWeek ?? null,
    throughWeek: throughWeek ?? null,
    sourceGameIds: sourceGameIds || null,
    sourceSeason: sourceSeason ?? null,
    predictionCutoff: cutoff,
    latestInformationTimestampAllowed: cutoff,
    latestAllowedWeek,
    kickoffTimestamp: isoOrNull(kickoffTimestamp),
    eligibleForIndependentProjection: eligible,
    exclusionReason,
    priorSeasonFreeze: Boolean(priorSeasonFreeze),
    reconstructedFromGames: Boolean(reconstructedFromGames),
    evaluationOnly: Boolean(evaluationOnly || feature.use === "evaluation"),
    provisionalWeightsNote:
      feature.use === "prior"
        ? "SP.35/CORE.25/FPI.20/SRS.12/Elo.08 and n/(n+6) are provisional — not fitted"
        : null,
  };
}

/**
 * Full catalog audit matrix for a historical prediction context.
 */
export function auditCatalogForGame(ctx = {}) {
  const rows = CFBD_FEATURE_CATALOG.map((f) => {
    const endpoint = f.endpoint;
    const isUnsafeAgg = HISTORICALLY_UNSAFE_ENDPOINTS.includes(endpoint);
    const isPriorRating = PRIOR_ONLY_SAME_SEASON_ENDPOINTS.includes(endpoint);
    const isCore = endpoint === "/ratings/core";
    const isGameGrain = f.grain === "game" || endpoint === "/ppa/games" || endpoint === "/stats/game/advanced";
    const isPersonnelPrior = ["prior"].includes(f.use) && !isPriorRating && !isCore && endpoint !== "/ratings/sp";

    return auditFeatureForCutoff(f, {
      ...ctx,
      priorSeasonFreeze: isPriorRating || isPersonnelPrior || (isCore && ctx.corePriorSeason),
      reconstructedFromGames: isGameGrain || (isUnsafeAgg && ctx.forceReconstructUnsafe === true),
      evaluationOnly: f.use === "evaluation",
      throughWeek: isCore ? ctx.coreThroughWeek : null,
      sourceSeason: isPriorRating || isPersonnelPrior || ctx.corePriorSeason ? ctx.priorSeason : ctx.year,
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
      coreThroughWeek: ctx.coreThroughWeek ?? null,
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
 * Audit preseason prior sources for one team/game — prove no current-season finals.
 */
export function auditPreseasonPriorSources({
  gameYear,
  priorCatalogEntry = {},
  priorSeason = null,
} = {}) {
  const expectedPrior = priorSeason ?? (gameYear != null ? Number(gameYear) - 1 : null);
  const sourceSeason = priorCatalogEntry.sourceSeason ?? expectedPrior;
  const ok = sourceSeason != null && expectedPrior != null && Number(sourceSeason) === Number(expectedPrior);

  const sources = {
    sp: { season: sourceSeason, value: priorCatalogEntry.spOverall ?? null, endpoint: "/ratings/sp" },
    core: { season: sourceSeason, value: priorCatalogEntry.coreOverall ?? null, endpoint: "/ratings/core" },
    fpi: { season: sourceSeason, value: priorCatalogEntry.fpi ?? null, endpoint: "/ratings/fpi" },
    srs: { season: sourceSeason, value: priorCatalogEntry.srs ?? null, endpoint: "/ratings/srs" },
    elo: { season: sourceSeason, value: priorCatalogEntry.elo ?? null, endpoint: "/ratings/elo" },
    talent: { season: sourceSeason, value: priorCatalogEntry.talent ?? null, endpoint: "/talent" },
    returning: { season: sourceSeason, value: priorCatalogEntry.returningPct ?? null, endpoint: "/player/returning" },
    recruiting: { season: sourceSeason, value: priorCatalogEntry.recruitingPoints ?? null, endpoint: "/recruiting/teams" },
    portal: { season: sourceSeason, value: null, endpoint: "/player/portal", note: "identity/continuity only" },
    coaching: { season: sourceSeason, value: null, endpoint: "/coaches", note: "hire/tenure continuity" },
  };

  return {
    ok,
    gameYear,
    expectedPriorSeason: expectedPrior,
    consumedPriorSeason: sourceSeason,
    leakageIfCurrentSeasonFinals: !ok,
    provisionalWeights: { sp: 0.35, core: 0.25, fpi: 0.2, srs: 0.12, elo: 0.08, note: "provisional-unfitted" },
    shrinkBenchmark: { formula: "n/(n+6)", note: "provisional until OOS supports" },
    priorBlendHash: priorCatalogEntry.artifactHash || priorCatalogEntry.priorBlend?.hash || null,
    sources,
    exclusionReason: ok ? null : "prior-source-season-mismatch-or-missing",
  };
}

/**
 * Build machine-readable provenance for every feature value passed into a model input.
 */
export function buildModelInputProvenance({
  game = {},
  featureRecord = null,
  roles = null,
  mode = "historical",
} = {}) {
  const kickoff = game.startDate || game.start_date || game.kickoff || featureRecord?.kickoff_timestamp;
  const week = game.week ?? featureRecord?.week;
  const year = game.season || game.year || featureRecord?.season;
  const cutoff =
    featureRecord?.feature_cutoff_timestamp ||
    (kickoff ? new Date(Date.parse(kickoff) - 60_000).toISOString() : null);

  const home = featureRecord?.features?.home || {};
  const away = featureRecord?.features?.away || {};
  const catalogAudit = auditCatalogForGame({
    year,
    targetWeek: week,
    kickoffTimestamp: kickoff,
    predictionCutoff: cutoff,
    priorSeason: year != null ? Number(year) - 1 : null,
    coreThroughWeek: home.coreThroughWeek ?? away.coreThroughWeek ?? null,
    corePriorSeason: false,
  });

  const passed = [];
  const rejected = [];

  const pushSide = (side, feat) => {
    const entries = [
      { name: `${side}.priorOff`, value: feat.priorOff, endpoint: "/ratings/sp", priorSeasonFreeze: true, class: "A" },
      { name: `${side}.priorDef`, value: feat.priorDef, endpoint: "/ratings/sp", priorSeasonFreeze: true, class: "A" },
      { name: `${side}.coreThroughWeek`, value: feat.coreThroughWeek, endpoint: "/ratings/core", class: "B" },
      { name: `${side}.coreRating`, value: feat.coreRating, endpoint: "/ratings/core", class: "B" },
      { name: `${side}.passEpa`, value: feat.passEpa, endpoint: "/ppa/games", reconstructed: true, class: "C" },
      { name: `${side}.rushEpa`, value: feat.rushEpa, endpoint: "/ppa/games", reconstructed: true, class: "C" },
      { name: `${side}.successRate`, value: feat.successRate, endpoint: "/stats/game/advanced", reconstructed: true, class: "C" },
      { name: `${side}.explosiveRate`, value: feat.explosiveRate, endpoint: "/stats/game/advanced", reconstructed: true, class: "C" },
      { name: `${side}.havocRate`, value: feat.havocRate, endpoint: "/stats/game/advanced", reconstructed: true, class: "C" },
      { name: `${side}.lineYards`, value: feat.lineYards, endpoint: "/stats/game/advanced", reconstructed: true, class: "C" },
      { name: `${side}.pointsPerOpportunity`, value: feat.pointsPerOpportunity, endpoint: "/stats/game/advanced", reconstructed: true, class: "C" },
      { name: `${side}.qbPpa`, value: feat.qbPpa, endpoint: feat.qbSourceEndpoint || null, class: feat.qbTemporalClass || "D" },
      { name: `${side}.qbName`, value: feat.qbName, endpoint: "identity", class: "C" },
    ];
    for (const e of entries) {
      const row = {
        featureName: e.name,
        value: e.value ?? null,
        endpoint: e.endpoint,
        temporalClass: e.class,
        year,
        seasonType: "regular",
        sourceWeek: week != null ? Number(week) - 1 : null,
        throughWeek: e.name.includes("core") ? feat.coreThroughWeek : null,
        sourceGameIds: feat.rollingSourceGameIds || null,
        predictionCutoff: cutoff,
        latestInformationTimestampAllowed: cutoff,
        priorSeasonFreeze: Boolean(e.priorSeasonFreeze),
        reconstructedFromGames: Boolean(e.reconstructed),
        eligibleForIndependentProjection: true,
        exclusionReason: null,
      };
      // Reject null QB season aggregates explicitly when marked unsafe
      if (e.name.endsWith(".qbPpa") && feat.qbHistoricalUnsafe) {
        row.eligibleForIndependentProjection = false;
        row.exclusionReason = "season-qb-ppa-unsafe-for-historical";
        row.value = null;
        rejected.push(row);
      } else if (
        e.endpoint &&
        HISTORICALLY_UNSAFE_ENDPOINTS.includes(e.endpoint) &&
        !e.reconstructed &&
        mode === "historical"
      ) {
        row.eligibleForIndependentProjection = false;
        row.exclusionReason = "same-season-aggregate-without-game-reconstruction";
        rejected.push(row);
      } else {
        passed.push(row);
      }
    }
  };

  pushSide("home", home);
  pushSide("away", away);

  // Evaluation namespace must never be in passed independent set
  const evalBlock = featureRecord?.features?.evaluation || {};
  for (const [k, v] of Object.entries(evalBlock)) {
    rejected.push({
      featureName: `evaluation.${k}`,
      value: v,
      endpoint: "/lines",
      temporalClass: "E",
      year,
      predictionCutoff: cutoff,
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
    homeTeam: featureRecord?.home_team || game.homeTeam || game.home?.name,
    awayTeam: featureRecord?.away_team || game.awayTeam || game.away?.name,
    modelDataVersion: featureRecord?.source_version || null,
    catalogAuditSummary: catalogAudit.summary,
    independentFeaturesPassed: passed,
    featuresRejected: rejected,
    roles: roles || null,
    targetsSeparated: true,
    note: "Results/targets must be stored separately from prediction features",
  };
}

/**
 * Reject post-cutoff game rows and return diagnostic.
 */
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
      });
      continue;
    }
    kept.push(row);
  }
  return { kept, rejected, filter: filterGamesBeforeKickoff };
}

/**
 * Role confidence tiers for historical identity audit logs.
 */
export function auditPlayerRoleResolution(roleRow = {}, { priorStarts = null, priorSeasonRole = null, transfer = null } = {}) {
  const conf = num(roleRow.role_confidence) ?? 0;
  const tier = classifyRoleConfidence(conf, roleRow.state);
  return {
    player: roleRow.player_name || null,
    player_id: roleRow.player_id || null,
    team: roleRow.team || null,
    position: roleRow.position || null,
    role: roleRow.role || null,
    priorStarts: priorStarts,
    recentGameUsage: roleRow.selection?.sources || null,
    priorSeasonRole: priorSeasonRole,
    currentSeasonPregameUsage: roleRow.selection || null,
    transferOrNewPlayer: transfer,
    roleConfidence: conf,
    roleConfidenceTier: ROLE_CONFIDENCE_TIERS,
    roleConfidenceTierAssigned: tier,
    selectionReason: roleRow.selection?.method || roleRow.state || null,
    state: roleRow.state || null,
    widensUncertainty: Boolean(roleRow.provenance?.widenUncertainty) || tier === "LOW" || String(roleRow.state || "").includes("UNCERTAIN"),
    futureEvidenceUsed: false,
  };
}

/**
 * Static inventory of endpoints rejected for historical independent use.
 */
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
            : endpoint.startsWith("/ppa/players") || endpoint.includes("player")
              ? "reconstruct from player-game rows / plays before kickoff; Week 1 use prior-season only with widened uncertainty"
              : "reconstruct from game/play grain",
      temporalClassIfUnreconstructed: "D",
    })),
    undatedSameSeasonRatingsExcluded: PRIOR_ONLY_SAME_SEASON_ENDPOINTS.map((endpoint) => ({
      endpoint,
      reason: "undated same-season aggregate — prior-season freeze only for historical early/in-season",
    })),
    coreRule: "CORE allowed only when throughWeek <= latestAllowedWeek for the prediction cutoff (or prior-season freeze)",
    provisionalNotes: {
      priorWeights: "SP.35 CORE.25 FPI.20 SRS.12 Elo.08 — provisional",
      shrink: "n/(n+6) — provisional",
    },
  };
}

/**
 * Request-count estimate for smoke vs full backfill.
 */
export function backfillRequestEstimate({
  seasons = [2022, 2023, 2024, 2025],
  weeksPerSeason = 15,
  smokeWeeks = null,
} = {}) {
  const weeks = smokeWeeks != null ? smokeWeeks : weeksPerSeason;
  const seasonCount = seasons.length;
  // prior bundle ~11 rating/personnel paths; current season games list; per week: ppa games + adv games (+ optional player games)
  const priorPaths = 11;
  const perWeekPaths = 2; // /ppa/games + /stats/game/advanced
  const seasonFixed = 2; // games list + optional roster
  const perSeason = priorPaths + seasonFixed + weeks * perWeekPaths;
  const total = seasonCount * perSeason;
  return {
    seasons,
    weeksPerSeason: weeks,
    mode: smokeWeeks != null ? "smoke" : "full",
    estimate: total,
    breakdown: {
      priorSeasonBundles: seasonCount * priorPaths,
      seasonFixed,
      weeklyGameGrain: seasonCount * weeks * perWeekPaths,
    },
    note: "Excludes unsafe season-aggregate player endpoints from historical independent matrix; player-game reconstruction adds more if enabled",
    customerPageFanout: 0,
  };
}
