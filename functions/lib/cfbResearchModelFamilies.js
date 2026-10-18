/**
 * Research model family registry (A–E).
 * Documents fitted vs scaffold status. Never invents coefficients or authorizes promotion.
 */

export const RESEARCH_MODEL_FAMILIES_VERSION = "cfb-research-model-families-v1";

export const RESEARCH_MODEL_FAMILIES = Object.freeze([
  {
    id: "A",
    name: "Repaired production champion",
    modelId: "CFB-FBIS-v2",
    authority: "production",
    fitted: true,
    consumedFields: ["priorOff", "priorDef", "ppaOff", "ppaDef", "gamesPlayed", "hfa"],
    excludedFields: [
      "offensiveSuccessRate",
      "coreOffense",
      "coreDefense",
      "passEpa",
      "rushEpa",
      "sdv_*",
    ],
    exclusionReason: "Not in fitted CFB-FBIS-v2 coefficient set",
    artifact: "data/models/cfb-fbis-v2.js",
    canPublishForecasts: true,
    canAuthorizeWager: false,
    note: "Champion scoring only; wager authority unchanged / not enabled by this registry",
  },
  {
    id: "B",
    name: "Advanced current-season CFBD (research shrink)",
    modelId: "CFB-RESEARCH-B",
    authority: "research_only",
    fitted: false,
    consumedFields: ["priorOff", "priorDef", "ppaOff", "ppaDef", "gamesPlayed", "hfa", "researchShrinkK"],
    excludedFields: ["coreOffense", "coreDefense", "sdv_*"],
    exclusionReason: "No leakage-safe fitted advanced-efficiency artifact yet",
    artifact: null,
    canPublishForecasts: false,
    canAuthorizeWager: false,
    note: "Sensitivity scaffold (faster prior decay) — not a fitted challenger",
  },
  {
    id: "C",
    name: "Advanced CFBD + CORE",
    modelId: "CFB-RESEARCH-C",
    authority: "research_only",
    fitted: false,
    consumedFields: ["requires_fitted_core_artifact"],
    excludedFields: ["all until CORE OOS artifact exists"],
    exclusionReason: "CORE remains research-only; zero production promotion path",
    artifact: null,
    canPublishForecasts: false,
    canAuthorizeWager: false,
    note: "Fails closed without fitted CORE artifact",
  },
  {
    id: "D",
    name: "Advanced CFBD + SDV",
    modelId: "CFB-RESEARCH-D",
    authority: "research_only",
    fitted: false,
    consumedFields: ["placeholder_equal_weight_blend"],
    excludedFields: ["sdv advanced fields until validated nonredundant fit"],
    exclusionReason: "SDV never enters fitted champion; no validated SDV challenger artifact",
    artifact: null,
    canPublishForecasts: false,
    canAuthorizeWager: false,
    note: "Equal-weight blend is diagnostic placeholder only",
  },
  {
    id: "E",
    name: "Optimized combined challenger",
    modelId: "CFB-RESEARCH-E",
    authority: "research_only",
    fitted: false,
    consumedFields: [],
    excludedFields: ["all"],
    exclusionReason: "FITTED_COMBINED_ARTIFACT_UNAVAILABLE",
    artifact: null,
    canPublishForecasts: false,
    canAuthorizeWager: false,
    note: "Do not publish numerical forecasts without legitimate fitted artifact",
  },
]);

/**
 * Snapshot for Data Ops / acceptance reporting.
 */
export function summarizeResearchModelFamilies() {
  const fitted = RESEARCH_MODEL_FAMILIES.filter((m) => m.fitted);
  const research = RESEARCH_MODEL_FAMILIES.filter((m) => !m.fitted);
  return {
    version: RESEARCH_MODEL_FAMILIES_VERSION,
    generatedAt: new Date().toISOString(),
    families: RESEARCH_MODEL_FAMILIES,
    fittedCount: fitted.length,
    researchScaffoldCount: research.length,
    productionAuthority: "A / CFB-FBIS-v2 only",
    promotionAuthorized: false,
    wagerAuthorized: false,
    evaluationSeparation: {
      oct17Diagnostic: "retrospective matched-cohort only",
      historicalOos: "walk-forward with temporal cutoffs — separate",
      prospectiveShadow: "pre-kickoff freezes only — separate",
    },
  };
}
