/**
 * CFB Data Operations API — SDV / CFBD registries, collection health, matrix, pipeline health.
 * Read-only. Never mutates champions or wager gates.
 */

import { searchSdvRegistry, summarizeSdvRegistry, SDV_SOURCE_REGISTRY } from "../lib/cfbSdvSourceRegistry.js";
import { searchCfbdRegistry, summarizeCfbdRegistry, CFBD_ENDPOINT_REGISTRY } from "../lib/cfbCfbdSourceRegistry.js";
import {
  buildSourceModelMatrix,
  searchUtilizationMatrix,
  endpointUtilizationSummary,
  buildScoringProvenance,
} from "../lib/cfbSourceModelMatrix.js";
import {
  buildCollectionManifest,
  compareExistingVsRequired,
  buildWeeklyOperatingReport,
  WEEKLY_COLLECTION_SCHEDULE,
} from "../lib/cfbWeeklyCollection.js";
import { summarizeRetentionPolicy } from "../lib/cfbRetentionPolicy.js";
import { evaluateCoreResearchReadiness, CORE_ARCHIVE_VERSION } from "../lib/cfbCoreArchive.js";
import { LINEAGE_VERSION } from "../lib/cfbCanonicalLineage.js";
import { reconcileCollectionHealth } from "../lib/cfbCollectionAlerts.js";
import { buildFeatureContractReport } from "../lib/cfbFeatureContract.js";
import { oct17UniverseStatus, reconcileWinnerAccuracyClaim } from "../lib/cfbOct17Reconciliation.js";
import {
  summarizeTier3Entitlements,
  searchTier3Entitlements,
  buildFeatureLevelCatalog,
} from "../lib/cfbTier3Entitlements.js";
import {
  researchModelFeaturePlan,
  graphqlShadowPlan,
} from "../lib/cfbAdvancedResearchFeatures.js";
import { summarizeResearchModelFamilies } from "../lib/cfbResearchModelFamilies.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function currentCfbSeasonWeek(now = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now instanceof Date ? now : new Date(now));
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const season = m >= 8 ? y : y - 1;
  const start = Date.UTC(season, 7, 25);
  const cur = Date.UTC(y, m - 1, day);
  const week = Math.max(1, Math.min(20, Math.floor((cur - start) / (7 * 86400000)) + 1));
  return { season, week };
}

async function loadManifestEvidence(env, season, week) {
  const evidenceByDataset = {};
  if (!env?.DB) return { evidenceByDataset, allowanceBlocked: false, coreArchiveCount: 0 };
  let allowanceBlocked = false;
  let coreArchiveCount = 0;
  try {
    const ctrl = await env.DB.prepare(
      "SELECT blocked_until_ms FROM cfb_cfbd_acquisition_control WHERE id = 1"
    ).first();
    if (ctrl && Number(ctrl.blocked_until_ms || 0) > Date.now()) allowanceBlocked = true;
  } catch {
    /* table may be absent pre-migration */
  }
  try {
    const rows =
      (
        await env.DB.prepare(
          `SELECT dataset_id, status, http_ok, row_count, team_coverage, through_week,
                  schema_ok, content_hash, ingestion_batch_id, collected_at
             FROM cfb_collection_manifests
            WHERE season = ? AND week = ?`
        )
          .bind(season, week)
          .all()
      ).results || [];
    for (const r of rows) {
      evidenceByDataset[r.dataset_id] = {
        httpOk: Number(r.http_ok) === 1,
        rowCount: r.row_count,
        teamCoverage: r.team_coverage,
        throughWeek: r.through_week,
        schemaOk: r.schema_ok == null ? true : Number(r.schema_ok) === 1,
        collectedAt: r.collected_at,
        contentHash: r.content_hash,
        ingestionBatchId: r.ingestion_batch_id,
        failed: r.status === "failed",
        stale: r.status === "stale",
        partial: r.status === "partial_coverage",
      };
    }
  } catch {
    /* pre-migration */
  }
  try {
    const throughWeek = Math.max(0, Number(week) - 1);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM cfb_core_weekly_archive
        WHERE season = ? AND through_week = ?`
    )
      .bind(season, throughWeek)
      .first();
    coreArchiveCount = Number(row?.n || 0);
  } catch {
    coreArchiveCount = 0;
  }
  return { evidenceByDataset, allowanceBlocked, coreArchiveCount };
}

async function pipelineHealth(env, season, week) {
  // Upcoming CFB matchups: prefer projection ledger / board if present
  let matchups = [];
  if (env?.DB) {
    try {
      matchups =
        (
          await env.DB.prepare(
            `SELECT game_id, home_team, away_team, kickoff_timestamp, season, week
               FROM cfb_pregame_feature_vectors
              WHERE season = ? AND week >= ?
              ORDER BY kickoff_timestamp ASC
              LIMIT 40`
          )
            .bind(season, Math.max(1, week - 1))
            .all()
            .catch(() => ({ results: [] }))
        ).results || [];
    } catch {
      matchups = [];
    }
  }

  return matchups.map((g) => {
    // Without per-game feature dump, report structural readiness from freeze presence
    const supported = Boolean(g.game_id);
    return {
      gameId: g.game_id,
      home: g.home_team,
      away: g.away_team,
      kickoff: g.kickoff_timestamp,
      season: g.season,
      week: g.week,
      sufficientData: supported,
      note: supported
        ? "Pregame feature vector present — verify scoring provenance on freeze"
        : "Missing pregame vector",
    };
  });
}

export async function onRequestGet(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const q = url.searchParams.get("q") || "";
  const section = url.searchParams.get("section") || "all";
  const { season: defSeason, week: defWeek } = currentCfbSeasonWeek();
  const season = Number(url.searchParams.get("season") || defSeason);
  const week = Number(url.searchParams.get("week") || defWeek);

  const { evidenceByDataset, allowanceBlocked, coreArchiveCount } = await loadManifestEvidence(
    env,
    season,
    week
  );
  const manifest = buildCollectionManifest({
    season,
    week,
    evidenceByDataset,
    allowanceBlocked,
  });
  const scheduleCompare = compareExistingVsRequired();
  const retention = summarizeRetentionPolicy();
  const coreReady = evaluateCoreResearchReadiness({
    archiveTeamCount: coreArchiveCount,
  });
  const matrix = q ? searchUtilizationMatrix(q) : buildSourceModelMatrix();
  const operatingReport = buildWeeklyOperatingReport({ season, week, manifest });
  const health = await pipelineHealth(env, season, week);
  const alerts = reconcileCollectionHealth({
    season,
    week,
    evidenceByDataset,
    allowanceBlocked,
    d1FeatureTeamCount: null,
  });

  const payload = {
    ok: true,
    sport: "cfb",
    season,
    week,
    lineageVersion: LINEAGE_VERSION,
    coreArchiveVersion: CORE_ARCHIVE_VERSION,
    sdv: {
      summary: summarizeSdvRegistry(),
      datasets: q ? searchSdvRegistry(q) : SDV_SOURCE_REGISTRY,
      note: "SDV never authorizes wagers; page visibility ≠ model consumption",
    },
    cfbd: {
      summary: summarizeCfbdRegistry(),
      endpoints: q ? searchCfbdRegistry(q).endpoints : CFBD_ENDPOINT_REGISTRY,
      features: q ? searchCfbdRegistry(q).features : undefined,
      endpointUtilization: endpointUtilizationSummary(),
      sharedQuotaNote: summarizeCfbdRegistry().sharedQuotaNote,
    },
    collection: {
      schedule: WEEKLY_COLLECTION_SCHEDULE,
      existingVsRequired: scheduleCompare,
      manifest,
      allowanceBlocked,
    },
    utilizationMatrix: matrix,
    retention,
    core: {
      researchReadiness: coreReady,
      archiveTeamCount: coreArchiveCount,
      researchOnly: true,
    },
    pipelineHealth: {
      matchups: health,
      supportedCount: health.filter((m) => m.sufficientData).length,
      total: health.length,
    },
    weeklyOperatingReport: operatingReport,
    collectionAlerts: alerts,
    featureContract: buildFeatureContractReport(),
    oct17: {
      universe: oct17UniverseStatus({ closeSnapshots: 45, gradedFinals: 41 }),
      winnerAccuracyExample: reconcileWinnerAccuracyClaim({
        correctWinners: 24,
        eligibleN: 42,
        reportedPct: 57.1,
      }),
    },
    scoringProvenanceExample: buildScoringProvenance({
      homeFeatures: { ppaOff: null, ppaDef: null, gamesPlayed: null },
      awayFeatures: { ppaOff: null, ppaDef: null, gamesPlayed: null },
      season,
      throughWeek: Math.max(0, week - 1),
    }),
    readinessApi: "/api/cfb-tuesday-readiness?date=2026-10-20",
    e2eValidationApi: "/api/cfb-e2e-validation",
    tier3: {
      summary: summarizeTier3Entitlements(),
      entitlements: q ? searchTier3Entitlements(q) : searchTier3Entitlements(""),
      featureLevels: buildFeatureLevelCatalog(),
      researchModels: researchModelFeaturePlan(),
      graphqlShadow: graphqlShadowPlan(),
    },
    researchModelFamilies: summarizeResearchModelFamilies(),
  };

  if (section === "sdv") return json({ ok: true, sdv: payload.sdv, collection: payload.collection });
  if (section === "cfbd") return json({ ok: true, cfbd: payload.cfbd, collection: payload.collection, tier3: payload.tier3 });
  if (section === "pipeline") return json({ ok: true, pipelineHealth: payload.pipelineHealth, core: payload.core });
  if (section === "matrix") return json({ ok: true, utilizationMatrix: payload.utilizationMatrix });
  if (section === "report") return json({ ok: true, weeklyOperatingReport: payload.weeklyOperatingReport });
  if (section === "tier3") return json({ ok: true, tier3: payload.tier3 });

  return json(payload);
}
