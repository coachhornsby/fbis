/**
 * Fail-closed CONVICTION qualification.
 * Research projections and MODEL LEAN output may remain visible.
 * They must not enter FBIS-HC-v1 until a production canary passes.
 */

import { expectedRoi, validAmericanOdds } from "./pricing.js";
import {
  EXPECTED_ROI_FORMULA_VERSION,
  EXPECTED_ROI_TOLERANCE,
  PROBABILITY_SCHEMA_VERSION,
  expectedRoiMatches,
  validateCanonicalProbability,
} from "./probability.js";

// Emergency kill switch only. Normal operation is governed by the durable
// production canary and the per-candidate integrity gates below.
export const CONVICTION_QUALIFICATION_PAUSED = false;
export const CONVICTION_PAUSE_MESSAGE =
  "CONVICTION QUALIFICATION PAUSED — probability integrity verification pending";
export const QUALIFICATION_RULE_VERSION = "FBIS-HC-v1";

const ML_MARKETS = new Set(["ML", "F5 ML"]);
const SPREAD_MARKETS = new Set(["SPREAD", "F5 SPREAD"]);
const TOTAL_MARKETS = new Set(["TOTAL", "F5 TOTAL"]);
const F5_MARKETS = new Set(["F5 ML", "F5 SPREAD", "F5 TOTAL"]);

export function convictionQualificationState({ canaryPassed = false } = {}) {
  const paused = CONVICTION_QUALIFICATION_PAUSED || !canaryPassed;
  return {
    paused,
    canaryPassed: Boolean(canaryPassed),
    message: paused ? CONVICTION_PAUSE_MESSAGE : "CONVICTION ACTIVE — every ticket passed frozen probability, market, price, and direction validation",
    probabilitySchemaVersion: PROBABILITY_SCHEMA_VERSION,
    expectedRoiFormulaVersion: EXPECTED_ROI_FORMULA_VERSION,
    qualificationRuleVersion: QUALIFICATION_RULE_VERSION,
  };
}

function fail(reason, extra = {}) {
  return {
    ok: false,
    reason,
    reasons: extra.reasons || [reason],
    modelProbability: extra.modelProbability ?? null,
    expectedRoi: extra.expectedRoi ?? null,
    marketNoVigProbability: extra.marketNoVigProbability ?? null,
  };
}

export function evaluateConvictionGates({
  candidate = {},
  frozen = {},
  game = {},
  paused = CONVICTION_QUALIFICATION_PAUSED,
  canaryPassed = false,
} = {}) {
  if (paused || !canaryPassed) {
    return fail("qualification-paused", { reasons: [CONVICTION_PAUSE_MESSAGE] });
  }
  if (candidate.lean === true) {
    return fail("lean-excluded");
  }
  if (candidate.qualified !== true && candidate.qualified !== 1) {
    return fail("not-qualified");
  }

  const prob = validateCanonicalProbability(candidate.modelProbability ?? candidate.fair);
  if (!prob.ok) return fail("frozen-probability-invalid", { reasons: [prob.reason || "missing"] });

  const price = candidate.pinPrice ?? candidate.benchmarkPrice ?? candidate.executionPrice;
  if (!validAmericanOdds(price)) return fail("invalid-american-odds");

  const opposing = candidate.marketComplete === true || candidate.implied != null || candidate.entryNoVig != null;
  if (!opposing) return fail("missing-opposing-price");

  const market = String(candidate.market || "");
  const side = String(candidate.side || "");
  if (ML_MARKETS.has(market) && side !== "HOME" && side !== "AWAY") return fail("side-mismatch");
  if (SPREAD_MARKETS.has(market) && side !== "HOME" && side !== "AWAY") return fail("side-mismatch");
  if (TOTAL_MARKETS.has(market) && side !== "OVER" && side !== "UNDER") return fail("side-mismatch");
  if (SPREAD_MARKETS.has(market) || TOTAL_MARKETS.has(market)) {
    const line = Number(candidate.line ?? candidate.executionLine ?? frozen.pinSpread ?? frozen.pinTotal);
    if (!Number.isFinite(line)) return fail("market-family-line-mismatch");
  }
  const frozenHome = validateCanonicalProbability(frozen.pHomeFinal ?? frozen.p_home_final);
  if (market === "ML" && frozenHome.ok) {
    const expected = side === "HOME" ? frozenHome.modelProbability : 1 - frozenHome.modelProbability;
    if (Math.abs(prob.modelProbability - expected) > 1e-6) return fail("side-model-mismatch");
  }

  const periodFamily = F5_MARKETS.has(market) ? "F5" : "FULL_GAME";
  const projectionPeriod = game.periodFamily || frozen.periodFamily || candidate.periodFamily || "FULL_GAME";
  if (periodFamily === "F5" && projectionPeriod !== "F5") return fail("period-family-mismatch");

  const checkpoint = candidate.checkpoint || frozen.checkpoint;
  if (!checkpoint) return fail("missing-projection-checkpoint");

  const freezeAt = Date.parse(String(candidate.qualifiedAt || frozen.frozenAt || ""));
  const startAt = Date.parse(String(game.start || frozen.start || candidate.start || ""));
  if (!Number.isFinite(freezeAt)) return fail("missing-freeze-timestamp");
  if (Number.isFinite(startAt) && freezeAt >= startAt) return fail("freeze-not-before-start");

  if (!candidate.modelVersion && !frozen.modelVersion && !game.modelVersion) {
    return fail("missing-model-version");
  }
  const ruleVersion = candidate.qualificationRuleVersion || frozen.qualificationRuleVersion || QUALIFICATION_RULE_VERSION;
  if (!ruleVersion) return fail("missing-qualification-rule-version");
  if (ruleVersion !== QUALIFICATION_RULE_VERSION) return fail("qualification-rule-version-mismatch");

  const recomputed = expectedRoi(prob.modelProbability, price);
  if (recomputed == null || !Number.isFinite(recomputed)) return fail("expected-roi-recompute-failed");
  if (candidate.ev != null && !expectedRoiMatches(candidate.ev, recomputed, EXPECTED_ROI_TOLERANCE)) {
    return fail("expected-roi-mismatch", { modelProbability: prob.modelProbability, expectedRoi: recomputed });
  }

  return {
    ok: true,
    reason: null,
    reasons: [],
    modelProbability: prob.modelProbability,
    expectedRoi: recomputed,
    marketNoVigProbability: candidate.implied ?? candidate.entryNoVig ?? null,
    probabilitySchemaVersion: PROBABILITY_SCHEMA_VERSION,
    expectedRoiFormulaVersion: EXPECTED_ROI_FORMULA_VERSION,
    qualificationRuleVersion: QUALIFICATION_RULE_VERSION,
  };
}
