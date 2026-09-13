/**
 * Canonical misprice / wager decision authority (Model Family Standard).
 *
 * States advance only with explicit evidence. Silent upgrades are illegal:
 *   MODEL_DISAGREEMENT ↛ CALIBRATED_EDGE
 *   CALIBRATED_EDGE ↛ QUALIFIED
 *   QUALIFIED ↛ AUTHORIZED
 *   AUTHORIZED ↛ EXECUTED
 *
 * PASS is not derived from qualified=false alone.
 * PASS requires an eligible independent model that evaluated the market.
 */

import { MISPRICE_LABEL, MISPRICE_STATE } from "./maturityStates.js";

export const REASON_CODE = Object.freeze({
  NO_PURE_MODEL: "NO_PURE_MODEL",
  MODEL_NOT_VALIDATED: "MODEL_NOT_VALIDATED",
  DISTRIBUTION_NOT_VALIDATED: "DISTRIBUTION_NOT_VALIDATED",
  CALIBRATOR_NOT_VALIDATED: "CALIBRATOR_NOT_VALIDATED",
  INSUFFICIENT_OOS: "INSUFFICIENT_OOS",
  STALE_PROJECTION: "STALE_PROJECTION",
  STALE_MARKET: "STALE_MARKET",
  AMBIGUOUS_EVENT_IDENTITY: "AMBIGUOUS_EVENT_IDENTITY",
  AMBIGUOUS_PLAYER_IDENTITY: "AMBIGUOUS_PLAYER_IDENTITY",
  MISSING_PRICE: "MISSING_PRICE",
  MISSING_TWO_WAY_MARKET: "MISSING_TWO_WAY_MARKET",
  COMMERCIAL_RIGHTS_BLOCK: "COMMERCIAL_RIGHTS_BLOCK",
  MODEL_NOT_AUTHORIZED: "MODEL_NOT_AUTHORIZED",
  RISK_BLOCK: "RISK_BLOCK",
  DUPLICATE_BLOCK: "DUPLICATE_BLOCK",
  CORRELATION_BLOCK: "CORRELATION_BLOCK",
  DATA_QUALITY_BLOCK: "DATA_QUALITY_BLOCK",
  MARKET_IMPLIED_NOT_INDEPENDENT: "MARKET_IMPLIED_NOT_INDEPENDENT",
  ACTION_CANNOT_QUALIFY: "ACTION_CANNOT_QUALIFY",
  ACTION_CANNOT_AUTHORIZE: "ACTION_CANNOT_AUTHORIZE",
  ARTIFACT_HASH_MISMATCH: "ARTIFACT_HASH_MISMATCH",
  AUTO_PROMOTE_FORBIDDEN: "AUTO_PROMOTE_FORBIDDEN",
  OPERATOR_PROMOTION_REQUIRED: "OPERATOR_PROMOTION_REQUIRED",
});

export const BOARD_DECISION = Object.freeze({
  NO_MODEL: "NO_MODEL",
  MODEL_ONLY: "MODEL_ONLY",
  MODEL_DISAGREEMENT: "MODEL_DISAGREEMENT",
  PASS: "PASS",
  QUALIFIED: "QUALIFIED",
  AUTHORIZED: "AUTHORIZED",
  BLOCKED: "BLOCKED",
  RESEARCH: "RESEARCH",
});

const MARKET_IMPLIED_KINDS = new Set([
  "PINNACLE_IMPLIED",
  "PINNACLE_IMPLIED_SCORE",
  "MARKET_IMPLIED",
  "MARKET_BENCHMARK",
]);

const STATE_RANK = Object.freeze({
  [MISPRICE_STATE.NO_MODEL]: 0,
  [MISPRICE_STATE.MODEL_ONLY]: 1,
  [MISPRICE_STATE.MODEL_DISAGREEMENT]: 2,
  [MISPRICE_STATE.CALIBRATED_EDGE]: 3,
  [MISPRICE_STATE.QUALIFIED]: 4,
  [MISPRICE_STATE.AUTHORIZED]: 5,
  [MISPRICE_STATE.BLOCKED]: -1,
});

/**
 * Hard transition guard — never allow silent upgrades.
 */
export function assertStateTransition(from, to, evidence = {}) {
  const f = STATE_RANK[from];
  const t = STATE_RANK[to];
  if (f == null || t == null) {
    return { ok: false, reasonCode: REASON_CODE.DATA_QUALITY_BLOCK, detail: "unknown-state" };
  }
  if (to === MISPRICE_STATE.BLOCKED) return { ok: true };
  if (to === from) return { ok: true };
  if (t < f) return { ok: true };

  if (to === MISPRICE_STATE.CALIBRATED_EDGE && !evidence.calibrated) {
    return { ok: false, reasonCode: REASON_CODE.CALIBRATOR_NOT_VALIDATED };
  }
  if (to === MISPRICE_STATE.QUALIFIED && !evidence.qualified) {
    return { ok: false, reasonCode: REASON_CODE.MODEL_NOT_AUTHORIZED };
  }
  if (to === MISPRICE_STATE.AUTHORIZED && !evidence.authorized) {
    return { ok: false, reasonCode: REASON_CODE.MODEL_NOT_AUTHORIZED };
  }
  if (to === MISPRICE_STATE.AUTHORIZED && evidence.authorized && !evidence.operatorApproved) {
    return { ok: false, reasonCode: REASON_CODE.OPERATOR_PROMOTION_REQUIRED };
  }
  if (t > f + 1) {
    return { ok: false, reasonCode: REASON_CODE.DATA_QUALITY_BLOCK, detail: "skipped-state" };
  }
  return { ok: true };
}

/**
 * Canonical rule: projectionKind != FBIS → cannot qualify / authorize.
 */
export function marketImpliedAuthority(projectionKind) {
  const kind = String(projectionKind || "").toUpperCase();
  if (!kind || kind === "FBIS") {
    return { isMarketImplied: false, canQualify: null, canAuthorizeWager: null };
  }
  const marketImplied = MARKET_IMPLIED_KINDS.has(kind);
  return {
    isMarketImplied: marketImplied,
    isIndependentFbis: false,
    canQualify: false,
    canAuthorizeWager: false,
    reasonCode: marketImplied
      ? REASON_CODE.MARKET_IMPLIED_NOT_INDEPENDENT
      : REASON_CODE.NO_PURE_MODEL,
    displayLabel: marketImplied ? "MARKET-IMPLIED SCORE" : "NON-FBIS PROJECTION",
    neverLabelAs: "FBIS PROJECTION",
  };
}

/**
 * PASS requires an eligible independent model that evaluated the market.
 * qualified=false alone is never PASS.
 */
export function deriveBoardDecision({
  hasPureProjection = false,
  projectionKind = null,
  modelValidated = false,
  evaluatedMarket = false,
  qualified = false,
  authorized = false,
  blocked = false,
  blockReasonCode = null,
  researchOnly = false,
} = {}) {
  if (blocked) {
    return {
      decision: BOARD_DECISION.BLOCKED,
      reasonCode: blockReasonCode || REASON_CODE.DATA_QUALITY_BLOCK,
      label: MISPRICE_LABEL.BLOCKED,
    };
  }
  if (authorized) {
    return {
      decision: BOARD_DECISION.AUTHORIZED,
      reasonCode: null,
      label: MISPRICE_LABEL.AUTHORIZED,
    };
  }
  if (qualified) {
    return {
      decision: BOARD_DECISION.QUALIFIED,
      reasonCode: null,
      label: MISPRICE_LABEL.QUALIFIED,
    };
  }

  const kind = String(projectionKind || "").toUpperCase();
  const implied = marketImpliedAuthority(projectionKind);
  const independentFbis = hasPureProjection && kind === "FBIS" && !implied.isMarketImplied;

  if (!independentFbis) {
    return {
      decision: BOARD_DECISION.NO_MODEL,
      reasonCode: implied.reasonCode || REASON_CODE.NO_PURE_MODEL,
      label: MISPRICE_LABEL.NO_MODEL,
    };
  }

  if (researchOnly || !modelValidated) {
    return {
      decision: evaluatedMarket ? BOARD_DECISION.MODEL_DISAGREEMENT : BOARD_DECISION.MODEL_ONLY,
      reasonCode: REASON_CODE.MODEL_NOT_VALIDATED,
      label: evaluatedMarket
        ? MISPRICE_LABEL.MODEL_DISAGREEMENT
        : MISPRICE_LABEL.MODEL_ONLY,
    };
  }

  if (evaluatedMarket) {
    return {
      decision: BOARD_DECISION.PASS,
      reasonCode: null,
      label: "Pass",
      note: "Eligible model evaluated market; no qualifying opportunity.",
    };
  }

  return {
    decision: BOARD_DECISION.MODEL_ONLY,
    reasonCode: null,
    label: MISPRICE_LABEL.MODEL_ONLY,
  };
}

export function canAdvanceToCalibratedEdge({
  distributionValidated = false,
  calibratorValidated = false,
  probabilityProvenanceOk = false,
  oosSufficient = false,
} = {}) {
  const blockers = [];
  if (!distributionValidated) blockers.push(REASON_CODE.DISTRIBUTION_NOT_VALIDATED);
  if (!calibratorValidated) blockers.push(REASON_CODE.CALIBRATOR_NOT_VALIDATED);
  if (!probabilityProvenanceOk) blockers.push(REASON_CODE.MODEL_NOT_VALIDATED);
  if (!oosSufficient) blockers.push(REASON_CODE.INSUFFICIENT_OOS);
  return { ok: blockers.length === 0, blockers };
}

export function actionCannotQualifyOrAuthorize() {
  return {
    canQualify: false,
    canAuthorizeWager: false,
    canExecute: false,
    reasonCodes: [REASON_CODE.ACTION_CANNOT_QUALIFY, REASON_CODE.ACTION_CANNOT_AUTHORIZE],
  };
}

export function autoPromoteForbidden() {
  return {
    allowed: false,
    reasonCode: REASON_CODE.AUTO_PROMOTE_FORBIDDEN,
    message: "No model may auto-promote. Operator decision required.",
  };
}
