/**
 * MLB challenger scaffolds around locked Savant RPG×SP champion.
 * Probable vs confirmed starter / expected vs confirmed lineup are distinct.
 */

import { MODEL_FAMILY, MODEL_MATURITY } from "./canonical/maturityStates.js";

export const MLB_CHAMPION_ID = "MLB-SAVANT-RPG-SP";

export const MLB_STARTER_STATE = Object.freeze({
  CONFIRMED: "CONFIRMED",
  PROBABLE: "PROBABLE",
  UNKNOWN: "UNKNOWN",
});

export const MLB_LINEUP_STATE = Object.freeze({
  CONFIRMED: "CONFIRMED",
  EXPECTED: "EXPECTED",
  UNKNOWN: "UNKNOWN",
});

/** Challenger ids are declared slots unless a full pipeline path exists. */
export const MLB_CHALLENGERS = Object.freeze([
  {
    modelId: "MLB-PARK-FACTORS-v1",
    focus: "explicit_park_factors",
    maturity: MODEL_MATURITY.RESEARCH,
    status: "IMPLEMENTED_SCAFFOLD",
    pipelineStatus: "IMPLEMENTATION_PENDING",
    pathComplete: false,
  },
  {
    modelId: "MLB-BULLPEN-v1",
    focus: "bullpen_quality_workload",
    maturity: MODEL_MATURITY.RESEARCH,
    status: "IMPLEMENTED_SCAFFOLD",
    pipelineStatus: "IMPLEMENTATION_PENDING",
    pathComplete: false,
  },
  {
    modelId: "MLB-LINEUP-LIFECYCLE-v1",
    focus: "confirmed_expected_lineup",
    maturity: MODEL_MATURITY.RESEARCH,
    status: "IMPLEMENTED_SCAFFOLD",
    pipelineStatus: "IMPLEMENTATION_PENDING",
    pathComplete: false,
    note: "Starter/lineup state enums + sigma uncertainty helper exist; full feature→model→freeze→grade path does not",
  },
  {
    modelId: "MLB-PLATOON-v1",
    focus: "platoon_effects",
    maturity: MODEL_MATURITY.RESEARCH,
    status: "IMPLEMENTATION_PENDING",
    pipelineStatus: "IMPLEMENTATION_PENDING",
    pathComplete: false,
  },
  {
    modelId: "MLB-WEATHER-ROOF-v1",
    focus: "weather_roof",
    maturity: MODEL_MATURITY.RESEARCH,
    status: "IMPLEMENTED_SCAFFOLD",
    pipelineStatus: "IMPLEMENTATION_PENDING",
    pathComplete: false,
  },
  {
    modelId: "MLB-STARTER-LEASH-v1",
    focus: "starter_leash_tto",
    maturity: MODEL_MATURITY.RESEARCH,
    status: "IMPLEMENTATION_PENDING",
    pipelineStatus: "IMPLEMENTATION_PENDING",
    pathComplete: false,
  },
  {
    modelId: "MLB-PLAYER-OPP-v1",
    focus: "player_opportunity_props",
    maturity: MODEL_MATURITY.RESEARCH,
    status: "IMPLEMENTED_SCAFFOLD",
    pipelineStatus: "IMPLEMENTATION_PENDING",
    pathComplete: false,
  },
]);

export function mlbContextUncertainty({
  starterState = MLB_STARTER_STATE.UNKNOWN,
  lineupState = MLB_LINEUP_STATE.UNKNOWN,
  baseSigma = 3.5,
} = {}) {
  let sigma = Number(baseSigma) || 3.5;
  const suppressFragile = [];
  if (starterState === MLB_STARTER_STATE.UNKNOWN) {
    sigma *= 1.35;
    suppressFragile.push("F5", "pitcher_props");
  } else if (starterState === MLB_STARTER_STATE.PROBABLE) {
    sigma *= 1.15;
  }
  if (lineupState === MLB_LINEUP_STATE.UNKNOWN) {
    sigma *= 1.2;
    suppressFragile.push("batter_props", "team_total");
  } else if (lineupState === MLB_LINEUP_STATE.EXPECTED) {
    sigma *= 1.08;
  }
  return {
    sigma,
    starterState,
    lineupState,
    suppressFragile: [...new Set(suppressFragile)],
    championPreserved: MLB_CHAMPION_ID,
    family: MODEL_FAMILY.PURE,
    canAutoPromote: false,
  };
}

export function mlbChallengerStatusReport() {
  return {
    champion: MLB_CHAMPION_ID,
    championPreserved: true,
    savantPalSeparation: true,
    actionDownstreamOnly: true,
    challengers: MLB_CHALLENGERS,
    starterStates: MLB_STARTER_STATE,
    lineupStates: MLB_LINEUP_STATE,
  };
}
