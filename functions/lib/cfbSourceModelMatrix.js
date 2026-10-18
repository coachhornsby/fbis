/**
 * Source → Model Utilization Matrix for CFB.
 * Proves page-visible fields are (or are not) consumed by scoring paths.
 */

import {
  CFB_AVAILABLE_CURRENT_SEASON_FIELDS,
  CFB_CHAMPION_CONSUMED_FIELDS,
  CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION,
  auditTeamFeatureUsage,
} from "./cfbFeatureUsageAudit.js";
import { CFBD_ENDPOINT_REGISTRY, summarizeCfbdRegistry } from "./cfbCfbdSourceRegistry.js";
import { SDV_SOURCE_REGISTRY, summarizeSdvRegistry } from "./cfbSdvSourceRegistry.js";
import { buildLineageRecord } from "./cfbCanonicalLineage.js";

export const MATRIX_VERSION = "cfb-source-model-matrix-v1";

const CHAMPION_KEYS = new Set(CFB_CHAMPION_CONSUMED_FIELDS.map((f) => f.key));
const UNUSED_KEYS = new Set(CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION);

function championEffect(key) {
  return CFB_CHAMPION_CONSUMED_FIELDS.find((f) => f.key === key)?.effect || null;
}

/**
 * One matrix row per canonical current-season field (+ prior + SDV families).
 */
export function buildSourceModelMatrix() {
  const cfbdRows = CFB_AVAILABLE_CURRENT_SEASON_FIELDS.map((f) => {
    const champion = CHAMPION_KEYS.has(f.key);
    const unused = UNUSED_KEYS.has(f.key);
    let utilization = "available_unused";
    let exclusionReason = null;
    if (champion) {
      utilization = "cfb_fbis_v2_champion";
    } else if (f.key.startsWith("core")) {
      utilization = "core_research_only";
      exclusionReason = "CORE research-only until explicit promotion; not scoreboard points";
    } else if (unused) {
      utilization = "ui_and_research_display";
      exclusionReason = "Collected and page-visible; zero fitted AA coefficient on champion";
    }
    return {
      provider: "cfbd",
      canonicalFeature: f.key,
      unit: f.unit,
      role: f.role,
      sourceDataset: inferCfbdDataset(f.key),
      originalField: inferCfbdOriginal(f.key),
      transformations: champion
        ? ["ppa_to_points: 26.5 + ppa*40", "prior_blend: n/(n+6)"]
        : [],
      consumedByCfbFbisV2: champion,
      consumedByCoreResearch: f.key.startsWith("core") || f.key === "coreThroughWeek",
      consumedByOtherResearch: !champion,
      usedOnlyForUiDisplay: !champion && unused,
      availableButUnused: unused && !champion,
      exclusionReason,
      championEffect: championEffect(f.key),
      utilization,
    };
  });

  // Prior inputs (not in AVAILABLE_CURRENT list but champion-consumed)
  for (const key of ["priorOff", "priorDef"]) {
    cfbdRows.push({
      provider: "cfbd",
      canonicalFeature: key,
      unit: "points prior",
      role: "prior",
      sourceDataset: "cfbd-ratings-sp|fpi|srs (prior-v1 chain)",
      originalField: key === "priorOff" ? "offense.rating|fpi|srs" : "defense.rating|fpi|srs",
      transformations: ["prior-v1 freeze from 2025 ratings chain"],
      consumedByCfbFbisV2: true,
      consumedByCoreResearch: false,
      consumedByOtherResearch: true,
      usedOnlyForUiDisplay: false,
      availableButUnused: false,
      exclusionReason: null,
      championEffect: championEffect(key),
      utilization: "cfb_fbis_v2_champion",
    });
  }

  const sdvRows = SDV_SOURCE_REGISTRY.flatMap((ds) =>
    (ds.fields || []).slice(0, 12).map((field) => ({
      provider: "sdv",
      canonicalFeature: `sdv:${ds.family}:${field}`,
      unit: ds.units,
      role: ds.family,
      sourceDataset: ds.id,
      originalField: field,
      transformations: ds.projectionConsumption === "pit_fallback_audit"
        ? ["map to deep-feed aliases for research PIT fallback"]
        : [],
      consumedByCfbFbisV2: false,
      consumedByCoreResearch: false,
      consumedByOtherResearch: ds.projectionConsumption === "research" || ds.projectionConsumption === "pit_fallback_audit",
      usedOnlyForUiDisplay: ds.projectionConsumption === "display",
      availableButUnused: ds.projectionConsumption === "none",
      exclusionReason: "SDV never authorizes wagers; fitted CFB-FBIS-v2 does not consume SDV",
      championEffect: null,
      utilization: ds.championConsumes ? "cfb_fbis_v2_champion" : ds.projectionConsumption,
    }))
  );

  return {
    version: MATRIX_VERSION,
    generatedAt: new Date().toISOString(),
    sdvSummary: summarizeSdvRegistry(),
    cfbdSummary: summarizeCfbdRegistry(),
    rows: [...cfbdRows, ...sdvRows],
    counts: {
      championConsumed: cfbdRows.filter((r) => r.consumedByCfbFbisV2).length,
      coreResearch: cfbdRows.filter((r) => r.consumedByCoreResearch).length,
      uiOrResearchOnly: cfbdRows.filter((r) => r.usedOnlyForUiDisplay || r.availableButUnused).length,
      sdvRows: sdvRows.length,
      sdvChampionConsumed: sdvRows.filter((r) => r.consumedByCfbFbisV2).length,
    },
    invariant: "SDV champion consumption must remain 0 until explicit authorization",
  };
}

function inferCfbdDataset(key) {
  if (key.startsWith("ppa")) return "cfbd-ppa-teams";
  if (key.startsWith("core")) return "cfbd-ratings-core";
  if (/Success|Explosive|Havoc|Line|PointsPer/i.test(key)) return "cfbd-stats-season-advanced";
  if (key === "gamesPlayed") return "cfbd-games";
  if (/PointsFor|PointsAgainst/i.test(key)) return "cfbd-games";
  return "cfbd-unknown";
}

function inferCfbdOriginal(key) {
  const map = {
    ppaOff: "offense.overall",
    ppaDef: "defense.overall",
    ppaPass: "offense.passing",
    ppaRush: "offense.rushing",
    ppaPassAllowed: "defense.passing",
    ppaRushAllowed: "defense.rushing",
    core: "overall",
    coreOffense: "offense",
    coreDefense: "defense",
    coreThroughWeek: "throughWeek",
    gamesPlayed: "completed games count (schedule preferred)",
  };
  return map[key] || key;
}

/**
 * Instrument a projection with the fields/timestamps it actually consumed.
 * Missing critical fields produce explicit diagnostics — no silent older-value reuse.
 */
export function buildScoringProvenance({
  homeFeatures = {},
  awayFeatures = {},
  homeTeamId = null,
  awayTeamId = null,
  season = null,
  throughWeek = null,
  collectionTime = null,
  ingestionBatchId = null,
  modelId = "CFB-FBIS-v2",
} = {}) {
  const collected = collectionTime || new Date().toISOString();
  const homeAudit = auditTeamFeatureUsage(homeFeatures);
  const awayAudit = auditTeamFeatureUsage(awayFeatures);

  const consumedKeys = ["ppaOff", "ppaDef", "gamesPlayed", "priorOff", "priorDef"];
  const homeLineage = {};
  const awayLineage = {};
  for (const key of consumedKeys) {
    const homeVal = homeFeatures[key] ?? homeAudit.championConsumed[key];
    const awayVal = awayFeatures[key] ?? awayAudit.championConsumed[key];
    homeLineage[key] = buildLineageRecord({
      provider: "cfbd",
      sourceDataset: inferCfbdDataset(key),
      originalField: inferCfbdOriginal(key),
      canonicalFeature: key,
      teamId: homeTeamId,
      season,
      throughWeek,
      units: CFB_AVAILABLE_CURRENT_SEASON_FIELDS.find((f) => f.key === key)?.unit || "points",
      originalValue: homeVal ?? null,
      transformations: key.startsWith("ppa")
        ? ["26.5 + ppa*40", "blend prior via n/(n+6)"]
        : key.startsWith("prior")
          ? ["prior-v1"]
          : ["observation count"],
      collectionTime: collected,
      ingestionBatchId,
      validationStatus: homeVal == null ? "missing" : "ok",
      modelEligibility: "champion",
      missingness: homeVal == null,
      dataQualityFlags: homeAudit.championConsumed.coreThroughWeekUsedAsN && key === "gamesPlayed"
        ? ["coreThroughWeekFallback"]
        : [],
    });
    awayLineage[key] = buildLineageRecord({
      provider: "cfbd",
      sourceDataset: inferCfbdDataset(key),
      originalField: inferCfbdOriginal(key),
      canonicalFeature: key,
      teamId: awayTeamId,
      season,
      throughWeek,
      units: CFB_AVAILABLE_CURRENT_SEASON_FIELDS.find((f) => f.key === key)?.unit || "points",
      originalValue: awayVal ?? null,
      transformations: key.startsWith("ppa")
        ? ["26.5 + ppa*40", "blend prior via n/(n+6)"]
        : key.startsWith("prior")
          ? ["prior-v1"]
          : ["observation count"],
      collectionTime: collected,
      ingestionBatchId,
      validationStatus: awayVal == null ? "missing" : "ok",
      modelEligibility: "champion",
      missingness: awayVal == null,
      dataQualityFlags: awayAudit.championConsumed.coreThroughWeekUsedAsN && key === "gamesPlayed"
        ? ["coreThroughWeekFallback"]
        : [],
    });
  }

  const diagnostics = [];
  for (const side of [
    { label: "home", audit: homeAudit },
    { label: "away", audit: awayAudit },
  ]) {
    for (const miss of side.audit.missingCriticalForChampion) {
      diagnostics.push({
        severity: "error",
        code: "missing_champion_input",
        side: side.label,
        field: miss,
        message: `Missing ${miss} for ${side.label}; do not silently reuse older values`,
      });
    }
    if (side.audit.championConsumed.coreThroughWeekUsedAsN) {
      diagnostics.push({
        severity: "warning",
        code: "games_played_uncertainty",
        side: side.label,
        field: "gamesPlayed",
        message: "gamesPlayed sourced from coreThroughWeek fallback — not verified schedule count",
      });
    }
  }

  // Page vs model disagreement: fields present but unused
  const pageModelGaps = [
    ...homeAudit.presentButUnusedByChampion.map((f) => ({ side: "home", field: f })),
    ...awayAudit.presentButUnusedByChampion.map((f) => ({ side: "away", field: f })),
  ];

  return {
    version: MATRIX_VERSION,
    modelId,
    collectionTime: collected,
    ingestionBatchId,
    season,
    throughWeek,
    home: {
      teamId: homeTeamId,
      consumed: homeAudit.championConsumed,
      lineage: homeLineage,
      presentButUnusedByChampion: homeAudit.presentButUnusedByChampion,
      missingCritical: homeAudit.missingCriticalForChampion,
    },
    away: {
      teamId: awayTeamId,
      consumed: awayAudit.championConsumed,
      lineage: awayLineage,
      presentButUnusedByChampion: awayAudit.presentButUnusedByChampion,
      missingCritical: awayAudit.missingCriticalForChampion,
    },
    diagnostics,
    pageModelGaps,
    ok: diagnostics.every((d) => d.severity !== "error"),
  };
}

/** Search matrix rows. */
export function searchUtilizationMatrix(query = "") {
  const matrix = buildSourceModelMatrix();
  const q = String(query || "").trim().toLowerCase();
  if (!q) return matrix;
  return {
    ...matrix,
    rows: matrix.rows.filter((r) => {
      const hay = [
        r.provider, r.canonicalFeature, r.sourceDataset, r.originalField,
        r.utilization, r.exclusionReason, r.unit,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    }),
  };
}

/** Endpoint-level utilization from CFBD registry. */
export function endpointUtilizationSummary() {
  return CFBD_ENDPOINT_REGISTRY.map((e) => ({
    id: e.id,
    endpoint: e.endpoint,
    championConsumes: e.championConsumes,
    researchConsumes: e.researchConsumes,
    uiConsumes: e.uiConsumes,
    evaluationOnly: Boolean(e.evaluationOnly),
    unusedByChampion: e.unusedByChampion || [],
  }));
}
