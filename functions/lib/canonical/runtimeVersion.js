/**
 * Canonical future runtime version source.
 *
 * Historical records retain their stamped model versions (v1.3 / college stamps).
 * New runtime work reads PLATFORM_RUNTIME_VERSION — never rewrite history.
 */

import { MODEL_VERSION } from "../weights.js";

/** Platform shell version for new runtime stamps. */
export const PLATFORM_RUNTIME_VERSION = MODEL_VERSION; // currently FBIS-v1.4

/** Documented cutover — historical rows remain as stamped. */
export const VERSION_CUTOVER = Object.freeze({
  platformRuntime: PLATFORM_RUNTIME_VERSION,
  historicalAliases: Object.freeze(["FBIS-v1.3", "FBIS-v1.4"]),
  cfbChampionModelId: "CFB-FBIS-v2",
  mlbChampionModelId: "MLB-SAVANT-RPG-SP",
  rule: "Never rewrite historical model_version stamps. Cohort comparisons must group by exact model_version.",
  productionShaEnvKeys: Object.freeze([
    "CF_PAGES_COMMIT_SHA",
    "GITHUB_SHA",
    "COMMIT_SHA",
  ]),
});

/**
 * Resolve runtime version for newly generated projections.
 * Does not mutate historical records.
 */
export function resolveRuntimeModelVersion({ sport = null, modelId = null } = {}) {
  if (modelId === "CFB-FBIS-v2" || (sport === "cfb" && !modelId)) {
    return { modelId: "CFB-FBIS-v2", modelVersion: "CFB-FBIS-v2", platformRuntime: PLATFORM_RUNTIME_VERSION };
  }
  if (modelId === "MLB-SAVANT-RPG-SP" || (sport === "mlb" && !modelId)) {
    return {
      modelId: "MLB-SAVANT-RPG-SP",
      modelVersion: "MLB-SAVANT-RPG-SP",
      platformRuntime: PLATFORM_RUNTIME_VERSION,
    };
  }
  return {
    modelId: modelId || null,
    modelVersion: modelId || PLATFORM_RUNTIME_VERSION,
    platformRuntime: PLATFORM_RUNTIME_VERSION,
  };
}

/**
 * Model Lab cohorts must not mix versions accidentally.
 */
export function assertSingleModelVersionCohort(rows = []) {
  const versions = new Set(
    rows.map((r) => r.modelVersion || r.model_version || r.modelId || r.model_id).filter(Boolean)
  );
  if (versions.size > 1) {
    return {
      ok: false,
      reason: "mixed-model-versions",
      versions: [...versions],
      message: "Model Lab cohort comparisons must not combine different model versions",
    };
  }
  return { ok: true, versions: [...versions] };
}

export function resolveProductionSha(env = {}) {
  for (const key of VERSION_CUTOVER.productionShaEnvKeys) {
    const v = env?.[key];
    if (v) return String(v);
  }
  return null;
}
