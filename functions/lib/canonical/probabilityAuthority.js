/**
 * Probability provenance + authority (Model Family Standard).
 *
 * Mathematical availability ≠ model authority.
 * Only validated probability + distribution + calibrator combinations may claim
 * fair probability, fair odds, probability edge, or EV.
 */

import { canShowValidatedProbability, MODEL_MATURITY } from "./maturityStates.js";
import { REASON_CODE } from "./decisionAuthority.js";

export const PROBABILITY_SOURCE = Object.freeze({
  FBIS_CALIBRATED: "FBIS_CALIBRATED",
  FBIS_RAW_DISTRIBUTION: "FBIS_RAW_DISTRIBUTION",
  HEURISTIC_SIGMA: "HEURISTIC_SIGMA",
  MARKET_IMPLIED: "MARKET_IMPLIED",
  MARKET_SHRUNK: "MARKET_SHRUNK",
  PLAYER_THRESHOLD: "PLAYER_THRESHOLD",
  UNKNOWN: "UNKNOWN",
});

export function buildProbabilityProvenance(partial = {}) {
  return {
    probabilitySource: partial.probabilitySource || PROBABILITY_SOURCE.UNKNOWN,
    modelFamily: partial.modelFamily ?? null,
    modelId: partial.modelId ?? null,
    modelVersion: partial.modelVersion ?? null,
    distributionModelId: partial.distributionModelId ?? null,
    distributionModelVersion: partial.distributionModelVersion ?? null,
    calibratorId: partial.calibratorId ?? null,
    calibratorVersion: partial.calibratorVersion ?? null,
    validationStatus: partial.validationStatus || MODEL_MATURITY.RESEARCH,
    oosSampleSize: Number.isFinite(Number(partial.oosSampleSize))
      ? Number(partial.oosSampleSize)
      : null,
    informationCutoff: partial.informationCutoff ?? null,
    generatedAt: partial.generatedAt || new Date().toISOString(),
    rawProbability:
      partial.rawProbability == null || !Number.isFinite(Number(partial.rawProbability))
        ? null
        : Number(partial.rawProbability),
  };
}

/** Wire format matching manual field names. */
export function probabilityProvenanceToWire(provenance = {}) {
  const p = buildProbabilityProvenance(provenance);
  return {
    probability_source: p.probabilitySource,
    model_family: p.modelFamily,
    model_id: p.modelId,
    model_version: p.modelVersion,
    distribution_model_id: p.distributionModelId,
    distribution_model_version: p.distributionModelVersion,
    calibrator_id: p.calibratorId,
    calibrator_version: p.calibratorVersion,
    validation_status: p.validationStatus,
    oos_sample_size: p.oosSampleSize,
    information_cutoff: p.informationCutoff,
    generated_at: p.generatedAt,
  };
}

export function probabilityAuthority(provenance = {}) {
  const p = buildProbabilityProvenance(provenance);
  const blockers = [];

  if (p.probabilitySource === PROBABILITY_SOURCE.MARKET_IMPLIED) {
    blockers.push(REASON_CODE.MARKET_IMPLIED_NOT_INDEPENDENT);
  }
  if (p.probabilitySource === PROBABILITY_SOURCE.HEURISTIC_SIGMA) {
    blockers.push(REASON_CODE.DISTRIBUTION_NOT_VALIDATED);
  }
  if (p.probabilitySource === PROBABILITY_SOURCE.MARKET_SHRUNK) {
    blockers.push(REASON_CODE.MODEL_NOT_VALIDATED);
  }
  if (p.probabilitySource === PROBABILITY_SOURCE.PLAYER_THRESHOLD) {
    blockers.push(REASON_CODE.CALIBRATOR_NOT_VALIDATED);
  }
  if (!p.modelId || !p.modelVersion) {
    blockers.push(REASON_CODE.MODEL_NOT_VALIDATED);
  }
  if (!p.distributionModelId || !p.distributionModelVersion) {
    blockers.push(REASON_CODE.DISTRIBUTION_NOT_VALIDATED);
  }
  if (!p.calibratorId || !p.calibratorVersion) {
    blockers.push(REASON_CODE.CALIBRATOR_NOT_VALIDATED);
  }
  if (!canShowValidatedProbability(p.validationStatus, true)) {
    blockers.push(REASON_CODE.MODEL_NOT_VALIDATED);
  }
  if (p.oosSampleSize == null || p.oosSampleSize <= 0) {
    blockers.push(REASON_CODE.INSUFFICIENT_OOS);
  }
  if (p.probabilitySource !== PROBABILITY_SOURCE.FBIS_CALIBRATED) {
    blockers.push(REASON_CODE.CALIBRATOR_NOT_VALIDATED);
  }

  const unique = [...new Set(blockers)];
  const ok = unique.length === 0;
  return {
    ok,
    blockers: unique,
    canShowFairProbability: ok,
    canShowFairOdds: ok,
    canShowProbabilityEdge: ok,
    canShowExpectedValue: ok,
    canQualify: ok,
    allowedSurfaces: ok
      ? ["fair_probability", "fair_odds", "probability_edge", "expected_value", "qualified_wager"]
      : ["projection", "market_line", "raw_disagreement", "validated_uncertainty_interval"],
    provenance: p,
    wire: probabilityProvenanceToWire(p),
  };
}

export function probabilityDisplayContract(provenance = {}) {
  const auth = probabilityAuthority(provenance);
  return {
    ...auth,
    showFairProbability: auth.canShowFairProbability,
    showFairOdds: auth.canShowFairOdds,
    showEv: auth.canShowExpectedValue,
    showProjection: true,
    showMarketLine: true,
    showRawDisagreement: true,
    labelWhenBlocked: "MODEL DISAGREEMENT",
  };
}
