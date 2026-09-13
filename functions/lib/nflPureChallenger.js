/**
 * NFL-FBIS-PURE research challenger scaffold.
 *
 * Builds on nflModel team-form shadow; richer EPA/PBP features are staged.
 * Never qualifies. Dead nflverse injury feeds are not current 2026 injury truth.
 */

import { MODEL_FAMILY, MODEL_MATURITY } from "./canonical/maturityStates.js";
import { buildProjectionContract } from "./canonical/lineageContract.js";
import {
  buildProbabilityProvenance,
  PROBABILITY_SOURCE,
  probabilityAuthority,
} from "./canonical/probabilityAuthority.js";
import { projectNflFormV0, NFL_SHADOW_ID } from "./nflModel.js";

export const NFL_PURE_CHALLENGER_ID = "NFL-FBIS-PURE";
export const NFL_PURE_CHALLENGER_VERSION = "research-v0";

export const NFL_FEATURE_PIPELINE = Object.freeze([
  "schedule_game_identity",
  "historical_pbp",
  "epa",
  "success_rate",
  "early_down_efficiency",
  "passing_down_efficiency",
  "rush_pass_splits",
  "explosiveness",
  "pressure_sacks",
  "turnovers_regression",
  "red_zone",
  "field_position",
  "special_teams",
  "pace",
  "rosters",
  "qb_identity_value",
  "injuries_practice_status",
  "active_inactive",
  "coaching_context",
  "venue_roof_surface",
  "weather",
  "rest_travel",
]);

export const NFL_PURE_STATUS = Object.freeze({
  implementation: "IMPLEMENTED_RESEARCH_ONLY",
  maturity: MODEL_MATURITY.RESEARCH,
  canQualify: false,
  canAuthorizeWager: false,
  oosStatus: "OOS_DATA_PENDING",
  injurySourceNote:
    "Do not use dead nflverse injury dumps as 2026 injury truth; rights-cleared official/licensed availability required.",
  featurePipeline: NFL_FEATURE_PIPELINE,
});

export function projectNflPureChallenger(game, formOpts = {}) {
  const base = projectNflFormV0(game, formOpts);
  if (!base?.ok) {
    return {
      ok: false,
      reason: base?.reason || "no-projection",
      modelId: NFL_PURE_CHALLENGER_ID,
      boardDecision: "NO_MODEL",
      displayLabel: "NO MODEL",
      marketBenchmarkLabel: "MARKET BENCHMARK",
      ...NFL_PURE_STATUS,
    };
  }

  const contract = buildProjectionContract({
    eventId: game?.eventId || game?.gameId || game?.id,
    sport: "nfl",
    modelId: NFL_PURE_CHALLENGER_ID,
    modelVersion: NFL_PURE_CHALLENGER_VERSION,
    projectedHome: base.home ?? base.projectedHome,
    projectedAway: base.away ?? base.projectedAway,
    projectedMargin: base.margin ?? base.projectedMargin,
    projectedTotal: base.total ?? base.projectedTotal,
    family: MODEL_FAMILY.PURE,
    marketInformed: false,
    calibrationLocked: false,
    canQualify: false,
    featureSnapshotId: formOpts.featureSnapshotId || null,
    informationCutoff: formOpts.informationCutoff || null,
  });

  const provenance = buildProbabilityProvenance({
    probabilitySource: PROBABILITY_SOURCE.HEURISTIC_SIGMA,
    modelFamily: MODEL_FAMILY.PURE,
    modelId: NFL_PURE_CHALLENGER_ID,
    modelVersion: NFL_PURE_CHALLENGER_VERSION,
    validationStatus: MODEL_MATURITY.RESEARCH,
  });

  return {
    ok: true,
    modelId: NFL_PURE_CHALLENGER_ID,
    modelVersion: NFL_PURE_CHALLENGER_VERSION,
    underlyingShadowId: NFL_SHADOW_ID,
    projectionKind: "FBIS",
    boardDecision: "RESEARCH",
    displayLabel: "RESEARCH · NFL PURE CHALLENGER",
    marketBenchmarkLabel: "MARKET BENCHMARK",
    neverLabelAs: "FBIS PROJECTION (production champion)",
    contract,
    probabilityAuthority: probabilityAuthority(provenance),
    canShowEv: false,
    canQualify: false,
    canAuthorizeWager: false,
    ...NFL_PURE_STATUS,
  };
}
