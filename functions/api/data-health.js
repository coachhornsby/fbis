/**
 * Data Health API — provider commercial status, freshness, governance meta.
 * Read-only. Never mutates champions or wager gates.
 */

import {
  buildSourceRegistryReport,
  buildModelRegistryReport,
  autoPromoteAllowed,
  listChampions,
  COMMERCIAL_STATUS,
} from "../lib/canonical/index.js";
import { buildOpsTelemetry } from "../lib/opsTelemetry.js";
import { durableHealth } from "../lib/jobs.js";
import { readMeta } from "../lib/store.js";
import { collegeKeyHealth } from "../lib/collegeSecrets.js";

export async function onRequestGet(context) {
  const env = context.env;
  const sources = buildSourceRegistryReport();
  const models = buildModelRegistryReport();
  const champions = listChampions();

  let d1Meta = [];
  let providerHealth = [];
  let sourceObservations = [];
  let apiUsage = [];
  let runtimeMeta = {};
  try {
    if (env?.DB) {
      d1Meta =
        (
          await env.DB.prepare(
            "SELECT key, value, updated_at FROM canonical_governance_meta ORDER BY key"
          )
            .all()
            .catch(() => ({ results: [] }))
        ).results || [];
      providerHealth =
        (
          await env.DB.prepare(
            "SELECT provider_id, sport, status, freshness_seconds, last_success_at, last_error_at, updated_at FROM canonical_provider_health ORDER BY provider_id"
          )
            .all()
            .catch(() => ({ results: [] }))
        ).results || [];
      sourceObservations =
        (
          await env.DB.prepare(
            `SELECT source,
                    MAX(retrieved_at) AS last_retrieved_at,
                    MAX(CASE WHEN status = 'ok' THEN retrieved_at END) AS last_success_at,
                    SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_observations,
                    SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS failed_observations,
                    MAX(record_count) AS max_record_count
               FROM source_observations
              GROUP BY source
              ORDER BY source`
          )
            .all()
            .catch(() => ({ results: [] }))
        ).results || [];
      apiUsage =
        (
          await env.DB.prepare(
            `SELECT source,
                    MAX(captured_at) AS last_attempt_at,
                    MAX(CASE WHEN ok = 1 THEN captured_at END) AS last_success_at,
                    SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_calls,
                    SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed_calls,
                    SUM(records_returned) AS records_returned
               FROM api_usage
              GROUP BY source
              ORDER BY source`
          )
            .all()
            .catch(() => ({ results: [] }))
        ).results || [];
      runtimeMeta = await readMeta(env).catch(() => ({}));
    }
  } catch {
    d1Meta = [];
    providerHealth = [];
    sourceObservations = [];
    apiUsage = [];
    runtimeMeta = {};
  }

  const commercialBlocks = (sources.sources || []).filter((s) =>
    [
      COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
      COMMERCIAL_STATUS.BLOCKED,
      COMMERCIAL_STATUS.REJECTED,
      COMMERCIAL_STATUS.RESEARCH_ONLY,
    ].includes(s.commercialStatus)
  );

  const blockedProviders = (sources.sources || []).filter(
    (s) => s.commercialStatus === COMMERCIAL_STATUS.BLOCKED
  );
  const unhealthyProviders = (providerHealth || []).filter((row) => {
    const status = String(row?.status || "").toUpperCase();
    return status && status !== "OK" && status !== "HEALTHY" && status !== "UNKNOWN";
  });

  // Never hardcode OK — derive from commercial rights + provider health rows.
  let qualityStatus = "OK";
  let freshness = "registry-static";
  if (blockedProviders.length > 0) {
    qualityStatus = "PROVIDER_OR_LICENSE_BLOCKED";
    freshness = "commercial-block";
  } else if (unhealthyProviders.length > 0) {
    qualityStatus = "DEGRADED";
    freshness = "provider-health";
  } else if (commercialBlocks.length > 0) {
    qualityStatus = "COMMERCIAL_REVIEW_REQUIRED";
    freshness = "commercial-review";
  }

  let ops = null;
  try {
    const health = await durableHealth(env).catch(() => ({}));
    ops = await buildOpsTelemetry(env, health || {});
  } catch {
    ops = null;
  }

  const observationBySource = Object.fromEntries((sourceObservations || []).map((r) => [String(r.source), r]));
  const usageBySource = Object.fromEntries((apiUsage || []).map((r) => [String(r.source), r]));
  // Use the exact credential resolver used by the college API clients. CFBD and
  // CBBD are allowed to share one bearer; health must not disagree with runtime.
  const collegeKeys = collegeKeyHealth(env);
  const runtimeConfig = {
    cfbd: {
      configured: collegeKeys.cfbdConfigured,
      implemented: true,
      sharedAlias: collegeKeys.sharedAlias,
      observation: observationBySource.cfbd || null,
      usage: usageBySource.cfbd || null,
    },
    cbbd: {
      configured: collegeKeys.cbbdConfigured,
      implemented: true,
      sharedAlias: collegeKeys.sharedAlias,
      observation: observationBySource.cbbd || null,
      usage: usageBySource.cbbd || null,
    },
    kenpom_api: { configured: Boolean(env?.KENPOM_API_KEY), implemented: true, observation: observationBySource.kenpom || null, usage: usageBySource.kenpom || null },
    ballpark_pal: {
      configured: Boolean(env?.BALLPARK_PAL_API_KEY),
      implemented: true,
      lastAttemptAt: runtimeMeta.last_pal_attempt_at || null,
      lastSuccessAt: runtimeMeta.last_pal_success_at || null,
      httpStatus: runtimeMeta.last_pal_http_status || null,
      recordsReturned: runtimeMeta.last_pal_records_returned != null && runtimeMeta.last_pal_records_returned !== "" ? Number(runtimeMeta.last_pal_records_returned) : null,
      persisted: runtimeMeta.last_pal_persisted != null && runtimeMeta.last_pal_persisted !== "" ? Number(runtimeMeta.last_pal_persisted) : null,
      error: runtimeMeta.last_pal_error || null,
    },
    baseball_savant: { configured: true, implemented: true, auth: "public" },
    nflverse: { configured: true, implemented: true, auth: "public" },
    nba_stats_licensed: { configured: false, implemented: false, reason: "production feed remains provider/license blocked" },
    parlay_pinnacle: { configured: Boolean(env?.PARLAY_API_KEY), implemented: true },
    action_apify: { configured: Boolean(env?.APIFY_TOKEN), implemented: true },
  };

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    qualityStatus,
    freshness,
    autoPromoteAllowed: autoPromoteAllowed(),
    actionShadowOnly: true,
    frozenChampions: champions.map((c) => ({
      modelId: c.modelId,
      sport: c.sport,
      coefficientsLocked: c.coefficientsLocked,
      canQualify: c.canQualify,
      canAuthorizeWager: c.canAuthorizeWager,
    })),
    commercialReviewRequired: commercialBlocks.map((s) => s.providerId),
    blockedProviders: blockedProviders.map((s) => s.providerId),
    unhealthyProviders: unhealthyProviders.map((r) => r.provider_id || r.providerId),
    sources,
    models: {
      count: models.count,
      champions: models.champions,
    },
    providerHealth,
    runtimeConfig,
    sourceObservations,
    apiUsage,
    governanceMeta: d1Meta,
    gapReport: "docs/canonical/manual-completion-matrix.md",
    ops,
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
