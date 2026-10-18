/**
 * CFBD Tier 3 entitlement matrix — verified against FBIS integration code,
 * acquisition receipts, and registry — not public-docs assumptions.
 *
 * Classification vocabulary:
 *   integrated | underutilized | not_collected | needs_verification |
 *   unavailable | not_useful_now
 */

import { CFBD_ENDPOINT_REGISTRY } from "./cfbCfbdSourceRegistry.js";
import { CFBD_FEATURE_CATALOG } from "./cfbdFeatureCatalog.js";
import { CFBD_GRAPHQL_OPERATIONS, CFBD_GRAPHQL_URL } from "./cfbdGraphql.js";
import { FEATURE_TIER, FITTED_NONZERO_FEATURES, classifyFeature } from "./cfbFeatureContract.js";

export const TIER3_ENTITLEMENTS_VERSION = "cfb-tier3-entitlements-v1";

/** Predictive feature levels (addendum §4). */
export const FEATURE_LEVEL = Object.freeze({
  L1_CORE_PRODUCTION: "L1_core_production",
  L2_ADVANCED_RESEARCH: "L2_advanced_research",
  L3_SPECIALIZED_LIVE: "L3_specialized_live",
});

/**
 * Map known REST endpoints to entitlement rows.
 * EntitlementStatus reflects code-verified collection, not marketing copy.
 */
export function buildRestEntitlementMatrix() {
  return CFBD_ENDPOINT_REGISTRY.map((e) => {
    let classification = "not_collected";
    if (e.collectedCurrently && e.championConsumes) classification = "integrated";
    else if (e.collectedCurrently && (e.researchConsumes || e.uiConsumes)) classification = "underutilized";
    else if (e.collectedCurrently && e.evaluationOnly) classification = "integrated";
    else if (!e.collectedCurrently && e.id === "cfbd-graphql") classification = "needs_verification";
    else if (!e.collectedCurrently) classification = "not_collected";

    let featureLevel = FEATURE_LEVEL.L2_ADVANCED_RESEARCH;
    if (e.championConsumes) featureLevel = FEATURE_LEVEL.L1_CORE_PRODUCTION;
    if (e.evaluationOnly) featureLevel = FEATURE_LEVEL.L2_ADVANCED_RESEARCH;
    if (/live|scoreboard|plays/i.test(e.endpoint || "")) featureLevel = FEATURE_LEVEL.L3_SPECIALIZED_LIVE;

    return {
      capabilityId: e.id,
      transport: "REST",
      endpointOrOperation: e.endpoint,
      name: e.name,
      fields: e.fields,
      units: e.units,
      seasonWeekScope: e.seasonWeekScope,
      publicationCadence: e.publicationCadence,
      historicalReconstruction: /week|game/i.test(e.seasonWeekScope || "")
        ? "week_or_game_scoped_when_entitled"
        : "season_aggregate_leakage_risk_without_as_of",
      entitlementStatus: e.collectedCurrently ? "observed_in_production_receipts" : "configured_but_idle",
      requestCost: e.sharedQuota ? "1 shared CFBD/CBBD call (assumed)" : "unknown",
      collectedCurrently: e.collectedCurrently,
      storage: e.storage,
      championConsumes: e.championConsumes,
      researchConsumes: e.researchConsumes,
      classification,
      featureLevel,
      fbisPriority: e.championConsumes
        ? "P0"
        : e.id === "cfbd-ratings-core"
          ? "P1_research"
          : e.collectedCurrently
            ? "P1_research"
            : "P2",
      gaps: e.gaps || [],
    };
  });
}

/**
 * GraphQL operations known to the governor — zero production query documents.
 */
export function buildGraphqlEntitlementMatrix() {
  return Object.values(CFBD_GRAPHQL_OPERATIONS).map((op) => ({
    capabilityId: `gql-${op}`,
    transport: "GraphQL",
    endpointOrOperation: `${CFBD_GRAPHQL_URL}#${op}`,
    name: op,
    fields: ["schema-dependent — production query documents not authored"],
    units: "n/a until query verified",
    seasonWeekScope: "caller-defined",
    publicationCadence: "unknown",
    historicalReconstruction: "needs_verification",
    entitlementStatus: "transport_scaffolded_no_production_queries",
    requestCost: "1 shared attempt assumed until billingSemanticsVerified",
    collectedCurrently: false,
    storage: "acquisition receipts only",
    championConsumes: false,
    researchConsumes: false,
    classification: "needs_verification",
    featureLevel: FEATURE_LEVEL.L2_ADVANCED_RESEARCH,
    fbisPriority: "P2_shadow_before_replace_rest",
    gaps: [
      "No production GraphQL query documents in repo",
      "Do not switch REST jobs until schema/access/cost verified",
    ],
  }));
}

/** Level assignment for catalog / champion features. */
export function assignFeatureLevel(canonicalFeature) {
  const key = String(canonicalFeature || "");
  if (FITTED_NONZERO_FEATURES.includes(key) || key === "priorOff" || key === "priorDef") {
    return FEATURE_LEVEL.L1_CORE_PRODUCTION;
  }
  if (/live|scoreboard|drive.?state|in.?game/i.test(key)) {
    return FEATURE_LEVEL.L3_SPECIALIZED_LIVE;
  }
  return FEATURE_LEVEL.L2_ADVANCED_RESEARCH;
}

export function buildFeatureLevelCatalog() {
  const fromCatalog = CFBD_FEATURE_CATALOG.map((f) => {
    const contract = classifyFeature(f.canonical);
    return {
      canonical: f.canonical,
      endpoint: f.endpoint,
      unit: f.unit,
      featureLevel: assignFeatureLevel(f.canonical),
      contractTiers: contract.tiers,
      influencesFittedChampion: contract.influencesFittedChampion,
      use: f.use,
      notes: f.notes || null,
    };
  });
  // Ensure L1 priors/hfa appear even if not in CFBD catalog rows
  for (const k of ["priorOff", "priorDef", "hfa", "gamesPlayed"]) {
    if (!fromCatalog.some((r) => r.canonical === k)) {
      fromCatalog.push({
        canonical: k,
        endpoint: "internal",
        unit: k === "gamesPlayed" ? "games" : "points",
        featureLevel: FEATURE_LEVEL.L1_CORE_PRODUCTION,
        contractTiers: [FEATURE_TIER.FITTED_NONZERO, FEATURE_TIER.ACTUALLY_CONSUMED],
        influencesFittedChampion: true,
        use: "matchup",
        notes: "Champion required input",
      });
    }
  }
  return fromCatalog;
}

export function summarizeTier3Entitlements() {
  const rest = buildRestEntitlementMatrix();
  const gql = buildGraphqlEntitlementMatrix();
  const features = buildFeatureLevelCatalog();
  const count = (rows, c) => rows.filter((r) => r.classification === c).length;
  return {
    version: TIER3_ENTITLEMENTS_VERSION,
    rest: {
      n: rest.length,
      integrated: count(rest, "integrated"),
      underutilized: count(rest, "underutilized"),
      notCollected: count(rest, "not_collected"),
      needsVerification: count(rest, "needs_verification"),
    },
    graphql: {
      n: gql.length,
      productionQueryDocuments: 0,
      shadowBeforeReplaceRest: true,
      billingSemanticsVerified: false,
    },
    featureLevels: {
      L1: features.filter((f) => f.featureLevel === FEATURE_LEVEL.L1_CORE_PRODUCTION).length,
      L2: features.filter((f) => f.featureLevel === FEATURE_LEVEL.L2_ADVANCED_RESEARCH).length,
      L3: features.filter((f) => f.featureLevel === FEATURE_LEVEL.L3_SPECIALIZED_LIVE).length,
      fittedChampionNonzero: features.filter((f) => f.influencesFittedChampion).length,
    },
    sharedQuotaNote:
      "CFBD+CBBD share monthly allowance; use provider-reported remaining, not only budget constants",
    directive:
      "Maximum predictive value — not maximum API calls. GraphQL shadow only until cost/schema proven.",
  };
}

export function searchTier3Entitlements(query = "") {
  const q = String(query || "").trim().toLowerCase();
  const all = [...buildRestEntitlementMatrix(), ...buildGraphqlEntitlementMatrix()];
  if (!q) return all;
  return all.filter((r) =>
    [r.capabilityId, r.name, r.endpointOrOperation, r.classification, r.featureLevel, ...(r.gaps || [])]
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
}
