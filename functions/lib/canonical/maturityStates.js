/**
 * Canonical maturity + commercial-use statuses from the FBIS Model Family Standard.
 * Source of truth for governance labels — sport manuals may specialize, not invent new silent states.
 */

export const MODEL_MATURITY = Object.freeze({
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  BASELINE_ONLY: "BASELINE_ONLY",
  RESEARCH: "RESEARCH",
  VALIDATION: "VALIDATION",
  LOCKED_OOS: "LOCKED_OOS",
  PROMOTION_CANDIDATE: "PROMOTION_CANDIDATE",
  PRODUCTION_CHAMPION: "PRODUCTION_CHAMPION",
  REJECTED: "REJECTED",
  DEPRECATED: "DEPRECATED",
});

export const FEATURE_STATUS = Object.freeze({
  LOCKED_VALIDATED: "LOCKED_VALIDATED",
  CHALLENGER: "CHALLENGER",
  EVALUATION_ONLY: "EVALUATION_ONLY",
  DEPRECATED: "DEPRECATED",
});

export const COMMERCIAL_STATUS = Object.freeze({
  PRIMARY_PRODUCTION: "PRIMARY_PRODUCTION",
  FALLBACK: "FALLBACK",
  RESEARCH_ONLY: "RESEARCH_ONLY",
  COMMERCIAL_USE_REVIEW_REQUIRED: "COMMERCIAL_USE_REVIEW_REQUIRED",
  BLOCKED: "BLOCKED",
  REJECTED: "REJECTED",
});

export const MODEL_FAMILY = Object.freeze({
  PURE: "PURE",
  MARKET: "MARKET",
  PLAYER: "PLAYER",
  PLAYER_MARKET: "PLAYER_MARKET",
  BASELINE: "BASELINE",
  ENSEMBLE: "ENSEMBLE",
});

export const MISPRICE_STATE = Object.freeze({
  NO_MODEL: "NO_MODEL",
  MODEL_ONLY: "MODEL_ONLY",
  DISAGREEMENT: "DISAGREEMENT",
  CALIBRATED_EDGE: "CALIBRATED_EDGE",
  QUALIFIED: "QUALIFIED",
  AUTHORIZED: "AUTHORIZED",
  BLOCKED: "BLOCKED",
});

/** Human labels — never expose snake_case on boards. */
export const MISPRICE_LABEL = Object.freeze({
  NO_MODEL: "No model",
  MODEL_ONLY: "Model only",
  DISAGREEMENT: "Model disagreement",
  CALIBRATED_EDGE: "Calibrated edge",
  QUALIFIED: "Qualified",
  AUTHORIZED: "Authorized",
  BLOCKED: "Blocked",
});

export const SNAPSHOT_TYPE = Object.freeze({
  OPEN: "OPEN",
  EARLY: "EARLY",
  MODEL_TIME: "MODEL_TIME",
  DECISION: "DECISION",
  FINAL_PREGAME: "FINAL_PREGAME",
  CLOSE: "CLOSE",
  UNKNOWN: "UNKNOWN",
});

export function isProductionChampion(maturity) {
  return maturity === MODEL_MATURITY.PRODUCTION_CHAMPION;
}

export function canShowValidatedProbability(maturity, calibrationLocked = false) {
  return (
    calibrationLocked === true &&
    [
      MODEL_MATURITY.LOCKED_OOS,
      MODEL_MATURITY.PROMOTION_CANDIDATE,
      MODEL_MATURITY.PRODUCTION_CHAMPION,
    ].includes(maturity)
  );
}

export function canShowEv(mispriceState) {
  return [
    MISPRICE_STATE.CALIBRATED_EDGE,
    MISPRICE_STATE.QUALIFIED,
    MISPRICE_STATE.AUTHORIZED,
  ].includes(mispriceState);
}
