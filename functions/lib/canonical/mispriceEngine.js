/**
 * Misprice engine — distinguishes MODEL DISAGREEMENT from calibrated EV.
 * Never manufactures EV/probability from unvalidated assumptions.
 */

import {
  MISPRICE_LABEL,
  MISPRICE_STATE,
  canShowEv,
} from "./maturityStates.js";
import { probabilityDisplayAllowed } from "./modelRegistry.js";

/**
 * @param {object} input
 * @param {string|null} input.modelId
 * @param {number|null} input.projection
 * @param {number|null} input.marketLine
 * @param {number|null} input.marketPriceAmerican
 * @param {number|null} input.modelProbability
 * @param {boolean} input.calibrationLocked
 * @param {boolean} input.identityResolved
 * @param {boolean} input.marketFresh
 * @param {boolean} input.qualified
 * @param {boolean} input.authorized
 * @param {string|null} input.blockReason
 */
export function evaluateMisprice(input = {}) {
  const {
    modelId = null,
    projection = null,
    marketLine = null,
    marketPriceAmerican = null,
    modelProbability = null,
    calibrationLocked = false,
    identityResolved = true,
    marketFresh = true,
    qualified = false,
    authorized = false,
    blockReason = null,
  } = input;

  if (blockReason) {
    return pack(MISPRICE_STATE.BLOCKED, {
      blockReason,
      projection,
      marketLine,
    });
  }
  if (!identityResolved) {
    return pack(MISPRICE_STATE.BLOCKED, {
      blockReason: "ambiguous-identity",
      projection,
      marketLine,
    });
  }
  if (projection == null || !Number.isFinite(Number(projection))) {
    return pack(MISPRICE_STATE.NO_MODEL, { projection: null, marketLine });
  }

  const proj = Number(projection);
  const line = marketLine == null ? null : Number(marketLine);
  const delta =
    line == null || !Number.isFinite(line) ? null : proj - line;

  if (line == null || !Number.isFinite(line)) {
    return pack(MISPRICE_STATE.MODEL_ONLY, {
      projection: proj,
      marketLine: null,
      disagreementUnits: null,
    });
  }

  const probOk =
    calibrationLocked === true &&
    probabilityDisplayAllowed(modelId) &&
    modelProbability != null &&
    Number.isFinite(Number(modelProbability)) &&
    Number(modelProbability) > 0 &&
    Number(modelProbability) < 1;

  const priceOk =
    marketPriceAmerican != null &&
    Number.isFinite(Number(marketPriceAmerican)) &&
    marketFresh;

  if (authorized && probOk && priceOk) {
    return pack(MISPRICE_STATE.AUTHORIZED, {
      projection: proj,
      marketLine: line,
      disagreementUnits: delta,
      modelProbability: Number(modelProbability),
      expectedValue: null, // computed by caller with declared vig method when authorized
      note: "Authorization is explicit and human-gated; EV filled by pricing layer.",
    });
  }

  if (qualified && probOk && priceOk) {
    return pack(MISPRICE_STATE.QUALIFIED, {
      projection: proj,
      marketLine: line,
      disagreementUnits: delta,
      modelProbability: Number(modelProbability),
    });
  }

  if (probOk && priceOk) {
    return pack(MISPRICE_STATE.CALIBRATED_EDGE, {
      projection: proj,
      marketLine: line,
      disagreementUnits: delta,
      modelProbability: Number(modelProbability),
    });
  }

  // Default research label — never EV.
  return pack(MISPRICE_STATE.DISAGREEMENT, {
    projection: proj,
    marketLine: line,
    disagreementUnits: delta,
    modelProbability: null,
    labelOverride: MISPRICE_LABEL.DISAGREEMENT,
    note:
      "Projection delta only. Probability/EV withheld until calibration is locked for this model/market.",
  });
}

function pack(state, extra = {}) {
  return {
    state,
    label: extra.labelOverride || MISPRICE_LABEL[state] || state,
    canShowEv: canShowEv(state),
    canShowProbability: [
      MISPRICE_STATE.CALIBRATED_EDGE,
      MISPRICE_STATE.QUALIFIED,
      MISPRICE_STATE.AUTHORIZED,
    ].includes(state),
    ...extra,
  };
}

export function rankMisprices(rows = []) {
  const weight = {
    [MISPRICE_STATE.AUTHORIZED]: 60,
    [MISPRICE_STATE.QUALIFIED]: 50,
    [MISPRICE_STATE.CALIBRATED_EDGE]: 40,
    [MISPRICE_STATE.DISAGREEMENT]: 20,
    [MISPRICE_STATE.MODEL_ONLY]: 10,
    [MISPRICE_STATE.NO_MODEL]: 0,
    [MISPRICE_STATE.BLOCKED]: -10,
  };
  return [...rows].sort((a, b) => {
    const wa = weight[a.state] || 0;
    const wb = weight[b.state] || 0;
    if (wb !== wa) return wb - wa;
    const da = Math.abs(Number(a.disagreementUnits) || 0);
    const db = Math.abs(Number(b.disagreementUnits) || 0);
    return db - da;
  });
}
