/**
 * CFB challenger feature infrastructure around locked CFB-FBIS-v2.
 * Does NOT change locked coefficients or score identity.
 * Live current-season CFBD ratings must not be labeled as a preseason prior.
 */

import { MODEL_MATURITY } from "./canonical/maturityStates.js";

export const CFB_CHAMPION_ID = "CFB-FBIS-v2";

export const CFB_CHALLENGER_FEATURES = Object.freeze([
  "qb_quality_continuity",
  "roster_continuity",
  "recruiting_talent",
  "transfers",
  "opponent_adjusted_rush_pass",
  "explosiveness",
  "havoc",
  "trenches",
  "finishing_drives",
  "field_position",
  "special_teams",
  "pace",
  "rest",
  "travel",
  "weather",
  "availability",
]);

export function buildCfbPriorProvenance({
  priorProvider = null,
  priorSeasonYear = null,
  priorAsOf = null,
  priorCollectedAt = null,
  priorIsLiveInSeason = null,
  priorSnapshotHash = null,
} = {}) {
  const live = priorIsLiveInSeason === true;
  return {
    prior_provider: priorProvider,
    prior_season_year: priorSeasonYear,
    prior_as_of: priorAsOf,
    prior_collected_at: priorCollectedAt,
    prior_is_live_in_season: live,
    prior_snapshot_hash: priorSnapshotHash,
    label: live ? "LIVE_IN_SEASON_PRIOR" : "PRESEASON_PRIOR",
    note: live
      ? "Live current-season ratings must not be described as a preseason prior. Ablation required before superiority claims."
      : "Preseason prior snapshot",
  };
}

/**
 * Declared challenger feature slots only.
 * Champion CFB-FBIS-v2 feature pipeline lives in cfbFeaturePipeline.js — separate.
 * These slots are NOT actual implemented feature pipelines.
 */
export function cfbChallengerSlots() {
  return CFB_CHALLENGER_FEATURES.map((focus) => ({
    modelId: `CFB-CHALLENGER-${focus.toUpperCase().replace(/_/g, "-")}`,
    focus,
    maturity: MODEL_MATURITY.RESEARCH,
    status: "IMPLEMENTED_SCAFFOLD",
    pipelineStatus: "IMPLEMENTATION_PENDING",
    declaredFeatureSlot: true,
    actualFeaturePipeline: false,
    canQualify: false,
    canAuthorizeWager: false,
    preservesChampion: CFB_CHAMPION_ID,
    autoPromote: false,
    path: {
      provider: null,
      rawArtifact: null,
      normalization: null,
      pitSnapshot: null,
      feature: null,
      modelConsumption: null,
      projection: null,
      freeze: null,
      grade: null,
    },
  }));
}

export function cfbChampionFreezeGuard() {
  return {
    modelId: CFB_CHAMPION_ID,
    coefficientsLocked: true,
    scoreIdentityLocked: true,
    canMutateInPlace: false,
    message: "Create a challenger version — never mutate CFB-FBIS-v2 locked coefficients.",
  };
}
