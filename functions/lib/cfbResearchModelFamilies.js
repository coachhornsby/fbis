/**
 * Research model family registry (A–E).
 * Documents fitted vs scaffold status. Never invents coefficients or authorizes promotion.
 */

import RESEARCH_B from "../../data/models/cfb-research-b-fitted.js";
import RESEARCH_E from "../../data/models/cfb-research-e-fitted.js";
import RESEARCH_E_DRIVE from "../../data/models/cfb-research-e_drive-fitted.js";
import RESEARCH_E_SIT from "../../data/models/cfb-research-e_sit-fitted.js";

export const RESEARCH_MODEL_FAMILIES_VERSION = "cfb-research-model-families-v2";

export const RESEARCH_MODEL_FAMILIES = Object.freeze([
  {
    id: "A",
    name: "Repaired production champion",
    modelId: "CFB-FBIS-v2",
    authority: "production",
    fitted: true,
    improvesOverChampion: null,
    consumedFields: ["priorOff", "priorDef", "ppaOff", "ppaDef", "gamesPlayed", "hfa"],
    excludedFields: [
      "offensiveSuccessRate",
      "coreOffense",
      "coreDefense",
      "passEpa",
      "rushEpa",
      "sdv_*",
    ],
    exclusionReason: "Not in fitted CFB-FBIS-v2 coefficient set (M*=A / T*=A)",
    artifact: "data/models/cfb-fbis-v2-fitted-aa.js",
    canPublishForecasts: true,
    canAuthorizeWager: false,
    note: "Champion scoring only; wager authority unchanged / not enabled by this registry",
  },
  {
    id: "B",
    name: "Advanced passing/rushing efficiency",
    modelId: "CFB-RESEARCH-B",
    authority: "research_only",
    fitted: true,
    improvesOverChampion: Boolean(RESEARCH_B?.oosValidation?.improvesOverChampion),
    oosDecision: RESEARCH_B?.oosValidation?.decision || null,
    consumedFields: RESEARCH_B?.consumedFields || ["base", "pass", "rush"],
    excludedFields: ["coreOffense", "coreDefense", "sdv_*"],
    exclusionReason: null,
    artifact: "data/models/cfb-research-b-fitted.js",
    canPublishForecasts: false,
    canAuthorizeWager: false,
    note:
      "Fold3 ridge on base+pass+rush; OOS does not beat champion A/A beyond practical ε — research only",
  },
  {
    id: "C",
    name: "Advanced CFBD + CORE",
    modelId: "CFB-RESEARCH-C",
    authority: "research_only",
    fitted: false,
    improvesOverChampion: false,
    consumedFields: ["requires_fitted_core_artifact"],
    excludedFields: ["all until CORE OOS artifact exists"],
    exclusionReason: "CORE remains research-only; zero production promotion path",
    artifact: null,
    canPublishForecasts: false,
    canAuthorizeWager: false,
    note: "Fails closed without fitted multi-season PIT CORE artifact",
  },
  {
    id: "D",
    name: "Advanced CFBD + SDV",
    modelId: "CFB-RESEARCH-D",
    authority: "research_only",
    fitted: false,
    improvesOverChampion: false,
    consumedFields: ["requires_fitted_sdv_artifact"],
    excludedFields: ["sdv advanced fields until validated nonredundant fit"],
    exclusionReason: "SDV never enters fitted champion; no validated SDV challenger artifact",
    artifact: null,
    canPublishForecasts: false,
    canAuthorizeWager: false,
    note: "No leakage-safe SDV ridge artifact; equal-weight blends remain diagnostic only",
  },
  {
    id: "E",
    name: "Optimized combined advanced CFBD",
    modelId: "CFB-RESEARCH-E",
    authority: "research_only",
    fitted: true,
    improvesOverChampion: Boolean(RESEARCH_E?.oosValidation?.improvesOverChampion),
    oosDecision: RESEARCH_E?.oosValidation?.decision || null,
    consumedFields: RESEARCH_E?.consumedFields || [],
    driveEfficiencyArtifact: "data/models/cfb-research-e_drive-fitted.js",
    situationalArtifact: "data/models/cfb-research-e_sit-fitted.js",
    excludedFields: ["coreOffense", "coreDefense", "sdv_*"],
    exclusionReason: null,
    artifact: "data/models/cfb-research-e-fitted.js",
    canPublishForecasts: false,
    canAuthorizeWager: false,
    note:
      "Fold3 ridge on pass/rush + success/drive + explosiveness/trenches; OOS does not beat A/A — research only",
  },
]);

/**
 * Snapshot for Data Ops / acceptance reporting.
 */
export function summarizeResearchModelFamilies() {
  const fitted = RESEARCH_MODEL_FAMILIES.filter((m) => m.fitted);
  const research = RESEARCH_MODEL_FAMILIES.filter((m) => m.id !== "A");
  const anyImproves = research.some((m) => m.improvesOverChampion === true);
  return {
    version: RESEARCH_MODEL_FAMILIES_VERSION,
    generatedAt: new Date().toISOString(),
    families: RESEARCH_MODEL_FAMILIES,
    fittedCount: fitted.length,
    researchScaffoldCount: research.filter((m) => !m.fitted).length,
    researchFittedCount: research.filter((m) => m.fitted).length,
    productionAuthority: "A / CFB-FBIS-v2 only",
    promotionAuthorized: false,
    wagerAuthorized: false,
    advancedStatsImproveChampion: anyImproves,
    advancedStatsVerdict: anyImproves
      ? "At least one fitted challenger beats champion A/A beyond practical ε — still research_only"
      : "Fitted advanced challengers (B, E, drive, situational) do not beat champion A/A beyond practical ε; CORE/SDV remain unfitted",
    auxiliaryFitted: {
      driveEfficiency: {
        modelId: RESEARCH_E_DRIVE.modelId,
        improvesOverChampion: RESEARCH_E_DRIVE.oosValidation?.improvesOverChampion === true,
        decision: RESEARCH_E_DRIVE.oosValidation?.decision,
      },
      situational: {
        modelId: RESEARCH_E_SIT.modelId,
        improvesOverChampion: RESEARCH_E_SIT.oosValidation?.improvesOverChampion === true,
        decision: RESEARCH_E_SIT.oosValidation?.decision,
      },
    },
    evaluationSeparation: {
      oct17Diagnostic: "retrospective matched-cohort only",
      historicalOos: "walk-forward fold3 2022–2024 train / 2023–2025 pooled OOS — separate",
      prospectiveShadow: "pre-kickoff freezes only — separate",
    },
  };
}

export function getResearchFittedArtifact(familyId) {
  if (familyId === "B") return RESEARCH_B;
  if (familyId === "E") return RESEARCH_E;
  if (familyId === "E_DRIVE") return RESEARCH_E_DRIVE;
  if (familyId === "E_SIT") return RESEARCH_E_SIT;
  return null;
}
