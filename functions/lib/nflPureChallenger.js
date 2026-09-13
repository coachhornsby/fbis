/**
 * NFL-FBIS-PURE research challenger.
 *
 * Honest status:
 * - PBP normalize + feature transforms + OLS walk-forward machinery:
 *   IMPLEMENTED_RESEARCH_ONLY
 * - Declared non-PBP families (rosters, injuries, weather, …): IMPLEMENTATION_PENDING
 * - Team-form fallback (projectNflFormV0) is NOT the manual pure model —
 *   labeled IMPLEMENTED_SCAFFOLD / underlying shadow only
 * - OOS_DATA_PENDING only when full pipeline ran and only future graded N remains
 *
 * Never qualifies. Never authorizes.
 */

import { MODEL_FAMILY, MODEL_MATURITY } from "./canonical/maturityStates.js";
import { buildProjectionContract } from "./canonical/lineageContract.js";
import {
  buildProbabilityProvenance,
  PROBABILITY_SOURCE,
  probabilityAuthority,
} from "./canonical/probabilityAuthority.js";
import { projectNflFormV0, NFL_SHADOW_ID } from "./nflModel.js";
import { featureStatusMap, NFL_COMPUTED_FROM_PBP, NFL_DECLARED_NOT_COMPUTED } from "./nflPbpFeatures.js";
import {
  buildNflResearchFeatureSnapshot,
  projectMarginFromFit,
  freezeNflResearchProjection,
  nflResearchPipelineStatus,
} from "./nflResearchPipeline.js";

// Literal IDs avoid TDZ circular init with nflResearchPipeline.js
export const NFL_PURE_CHALLENGER_ID = "NFL-FBIS-PURE";
export const NFL_PURE_CHALLENGER_VERSION = "pbp-ols-research-v0";

/** Declared manual feature list — presence here ≠ implemented. */
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
  /** Not OOS_DATA_PENDING — unimplemented families and production auto-freeze/grade remain. */
  oosStatus: null,
  remainingImplementation: [
    "non_pbp_feature_families",
    "production_job_auto_freeze",
    "production_job_auto_grade",
    "operator_promotion",
  ],
  injurySourceNote:
    "Do not use dead nflverse injury dumps as 2026 injury truth; rights-cleared official/licensed availability required.",
  featurePipelineDeclared: NFL_FEATURE_PIPELINE,
  featurePipelineComputed: NFL_COMPUTED_FROM_PBP,
  featurePipelinePending: NFL_DECLARED_NOT_COMPUTED,
});

export function nflFeatureAudit() {
  return featureStatusMap();
}

/**
 * Prefer PBP research projection when fit + features provided.
 * Otherwise optional team-form fallback is explicitly labeled as scaffold/shadow — not pure manual.
 */
export function projectNflPureChallenger(game, opts = {}) {
  const informationCutoff = opts.informationCutoff || null;
  const eventId = game?.eventId || game?.gameId || game?.id;

  if (opts.fit?.ok && (opts.featureSnapshot?.features || opts.rawPlays)) {
    let snap = opts.featureSnapshot;
    if (!snap?.features && opts.rawPlays) {
      snap = buildNflResearchFeatureSnapshot({
        rawPlays: opts.rawPlays,
        homeTeam: game?.home?.abbr || game?.homeTeam || opts.homeTeam,
        awayTeam: game?.away?.abbr || game?.awayTeam || opts.awayTeam,
        informationCutoff,
        minPlays: opts.minPlays,
      });
    }
    if (!snap?.ok && snap?.features == null) {
      return {
        ok: false,
        reason: snap?.reason || "feature-snapshot-failed",
        modelId: NFL_PURE_CHALLENGER_ID,
        boardDecision: "NO_MODEL",
        displayLabel: "NO MODEL",
        ...NFL_PURE_STATUS,
        featureAudit: nflFeatureAudit(),
        pipeline: nflResearchPipelineStatus(),
      };
    }
    const proj = projectMarginFromFit(opts.fit, snap.features);
    if (!proj.ok) {
      return {
        ok: false,
        reason: proj.reason,
        modelId: NFL_PURE_CHALLENGER_ID,
        boardDecision: "NO_MODEL",
        displayLabel: "NO MODEL",
        ...NFL_PURE_STATUS,
        featureAudit: nflFeatureAudit(),
      };
    }
    const frozen = freezeNflResearchProjection({
      eventId,
      homeTeam: game?.home?.abbr || opts.homeTeam,
      awayTeam: game?.away?.abbr || opts.awayTeam,
      projection: proj,
      featureSnapshot: snap,
      informationCutoff,
    });
    const contract = buildProjectionContract({
      eventId,
      sport: "nfl",
      modelId: NFL_PURE_CHALLENGER_ID,
      modelVersion: NFL_PURE_CHALLENGER_VERSION,
      projectedHome: proj.projectedHome,
      projectedAway: proj.projectedAway,
      projectedMargin: proj.projectedMargin,
      projectedTotal: proj.projectedTotal,
      family: MODEL_FAMILY.PURE,
      marketInformed: false,
      calibrationLocked: false,
      canQualify: false,
      featureSnapshotId: frozen.featureSnapshotId,
      informationCutoff,
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
      projectionKind: "FBIS",
      boardDecision: "RESEARCH",
      displayLabel: "RESEARCH · NFL PURE PBP-OLS",
      marketBenchmarkLabel: "MARKET BENCHMARK",
      neverLabelAs: "FBIS PROJECTION (production champion)",
      contract,
      frozen,
      featureSnapshot: snap,
      probabilityAuthority: probabilityAuthority(provenance),
      canShowEv: false,
      canQualify: false,
      canAuthorizeWager: false,
      dataFeedsCurrentProjection: "PIT-filtered nflfastR/nflverse-shaped PBP → computed feature families",
      ...NFL_PURE_STATUS,
      featureAudit: nflFeatureAudit(),
      pipeline: nflResearchPipelineStatus(),
    };
  }

  // Explicit fallback — not the manual pure model.
  const base = projectNflFormV0(game, opts);
  if (!base?.ok) {
    return {
      ok: false,
      reason: base?.reason || "no-projection",
      modelId: NFL_PURE_CHALLENGER_ID,
      boardDecision: "NO_MODEL",
      displayLabel: "NO MODEL",
      marketBenchmarkLabel: "MARKET BENCHMARK",
      implementation: "IMPLEMENTATION_PENDING",
      underlyingFallback: NFL_SHADOW_ID,
      note: "PBP research path requires fit + featureSnapshot/rawPlays; team-form fallback unavailable",
      ...NFL_PURE_STATUS,
      featureAudit: nflFeatureAudit(),
    };
  }

  const contract = buildProjectionContract({
    eventId,
    sport: "nfl",
    modelId: NFL_PURE_CHALLENGER_ID,
    modelVersion: `${NFL_PURE_CHALLENGER_VERSION}+form-fallback`,
    projectedHome: base.home ?? base.projectedHome,
    projectedAway: base.away ?? base.projectedAway,
    projectedMargin: base.margin ?? base.projectedMargin,
    projectedTotal: base.total ?? base.projectedTotal,
    family: MODEL_FAMILY.PURE,
    marketInformed: false,
    calibrationLocked: false,
    canQualify: false,
    featureSnapshotId: opts.featureSnapshotId || null,
    informationCutoff,
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
    modelVersion: `${NFL_PURE_CHALLENGER_VERSION}+form-fallback`,
    underlyingShadowId: NFL_SHADOW_ID,
    projectionKind: "FBIS",
    boardDecision: "RESEARCH",
    displayLabel: "RESEARCH · NFL FORM FALLBACK (NOT PURE MANUAL)",
    marketBenchmarkLabel: "MARKET BENCHMARK",
    neverLabelAs: "FBIS PROJECTION (production champion)",
    contract,
    probabilityAuthority: probabilityAuthority(provenance),
    canShowEv: false,
    canQualify: false,
    canAuthorizeWager: false,
    implementation: "IMPLEMENTED_SCAFFOLD",
    dataFeedsCurrentProjection: "team scoring form priors (NFL-TEAM-FORM-v0) — not PBP pure manual features",
    oosStatus: null,
    maturity: MODEL_MATURITY.RESEARCH,
    featurePipelineDeclared: NFL_FEATURE_PIPELINE,
    featurePipelineComputed: NFL_COMPUTED_FROM_PBP,
    featurePipelinePending: NFL_DECLARED_NOT_COMPUTED,
    featureAudit: nflFeatureAudit(),
    pipeline: nflResearchPipelineStatus(),
    note: "Form fallback is a wrapper around an older shadow — not evidence the declared feature list is implemented",
  };
}
