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

export async function onRequestGet(context) {
  const env = context.env;
  const sources = buildSourceRegistryReport();
  const models = buildModelRegistryReport();
  const champions = listChampions();

  let d1Meta = [];
  let providerHealth = [];
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
    }
  } catch {
    d1Meta = [];
    providerHealth = [];
  }

  const commercialBlocks = (sources.sources || []).filter((s) =>
    [
      COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
      COMMERCIAL_STATUS.BLOCKED,
      COMMERCIAL_STATUS.REJECTED,
      COMMERCIAL_STATUS.RESEARCH_ONLY,
    ].includes(s.commercialStatus)
  );

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    qualityStatus: "OK",
    freshness: "registry-static",
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
    sources,
    models: {
      count: models.count,
      champions: models.champions,
    },
    providerHealth,
    governanceMeta: d1Meta,
    gapReport: "docs/canonical/gap-report-2026-09-13.md",
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
