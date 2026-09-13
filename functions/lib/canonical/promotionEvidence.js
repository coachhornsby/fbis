/**
 * Model Lab closed-loop promotion evidence.
 *
 * Promotion criteria must be answerable from evidence — never invented.
 * No auto-promotion. Walk-forward only (no shuffled K-fold as final temporal validation).
 * Fixture ridge artifacts must not masquerade as trained production models.
 */

import { createHash } from "node:crypto";
import { MODEL_MATURITY } from "./maturityStates.js";
import { REASON_CODE } from "./decisionAuthority.js";
import { autoPromoteAllowed } from "./modelRegistry.js";

export const EVIDENCE_STATUS = Object.freeze({
  IMPLEMENTED_RESEARCH_ONLY: "IMPLEMENTED_RESEARCH_ONLY",
  VALIDATION_PENDING: "VALIDATION_PENDING",
  OOS_DATA_PENDING: "OOS_DATA_PENDING",
  OPERATOR_PROMOTION_REQUIRED: "OPERATOR_PROMOTION_REQUIRED",
  PROVIDER_OR_LICENSE_BLOCKED: "PROVIDER_OR_LICENSE_BLOCKED",
  REJECTED: "REJECTED",
});

/**
 * Build a promotion evidence packet. Missing fields stay null — never fabricate metrics.
 */
export function buildPromotionEvidence(partial = {}) {
  return {
    modelId: partial.modelId ?? null,
    modelVersion: partial.modelVersion ?? null,
    artifactRef: partial.artifactRef ?? null,
    artifactContentHash: partial.artifactContentHash ?? null,
    trainingHash: partial.trainingHash ?? null,
    featureManifestId: partial.featureManifestId ?? null,
    pitRules: partial.pitRules ?? "effective_at <= information_cutoff < event_start",
    trainingPeriod: partial.trainingPeriod ?? null,
    validationPeriod: partial.validationPeriod ?? null,
    foldIds: Array.isArray(partial.foldIds) ? [...partial.foldIds] : [],
    foldScheme: partial.foldScheme || "expanding_walk_forward",
    oosN: Number.isFinite(Number(partial.oosN)) ? Number(partial.oosN) : null,
    baselineModelId: partial.baselineModelId ?? null,
    marketBenchmark: partial.marketBenchmark ?? "PINNACLE",
    mae: finiteOrNull(partial.mae),
    rmse: finiteOrNull(partial.rmse),
    medianAbsError: finiteOrNull(partial.medianAbsError),
    bias: finiteOrNull(partial.bias),
    brier: finiteOrNull(partial.brier),
    logLoss: finiteOrNull(partial.logLoss),
    calibrationDiagnostics: partial.calibrationDiagnostics ?? null,
    pairedErrorVsBaseline: partial.pairedErrorVsBaseline ?? null,
    pairedErrorVsMarket: partial.pairedErrorVsMarket ?? null,
    bootstrapConfidenceIntervals: partial.bootstrapConfidenceIntervals ?? null,
    ablationResults: partial.ablationResults ?? null,
    missingness: partial.missingness ?? null,
    leakageChecks: partial.leakageChecks ?? null,
    promotionCriteriaResult: partial.promotionCriteriaResult ?? null,
    operatorDecision: partial.operatorDecision ?? null,
    maturity: partial.maturity || MODEL_MATURITY.RESEARCH,
    generatedAt: partial.generatedAt || new Date().toISOString(),
  };
}

function finiteOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hashArtifactContent(content) {
  return createHash("sha256").update(String(content ?? "")).digest("hex");
}

/**
 * Verify artifact content hash — mismatch blocks promotion.
 */
export function assertArtifactHash(expectedHash, content) {
  if (!expectedHash) {
    return { ok: false, reasonCode: REASON_CODE.ARTIFACT_HASH_MISMATCH, detail: "missing-expected-hash" };
  }
  const actual = hashArtifactContent(content);
  if (actual !== String(expectedHash).toLowerCase() && actual !== String(expectedHash)) {
    return { ok: false, reasonCode: REASON_CODE.ARTIFACT_HASH_MISMATCH, expected: expectedHash, actual };
  }
  return { ok: true, hash: actual };
}

/**
 * Reject shuffled K-fold as final temporal validation.
 */
export function assertWalkForwardFolds(evidence = {}) {
  const scheme = String(evidence.foldScheme || "").toLowerCase();
  if (scheme.includes("kfold") || scheme.includes("k-fold") || scheme.includes("shuffled")) {
    return {
      ok: false,
      reason: "shuffled-kfold-forbidden",
      message: "Final temporal validation must be expanding or rolling walk-forward",
    };
  }
  if (!["expanding_walk_forward", "rolling_walk_forward", "expanding", "rolling"].includes(scheme)) {
    return {
      ok: false,
      reason: "unknown-fold-scheme",
      message: "Declare expanding_walk_forward or rolling_walk_forward",
    };
  }
  return { ok: true };
}

/**
 * Fixture / ridge placeholder artifacts cannot promote.
 */
export function assertNotFixtureArtifact(evidence = {}) {
  const ref = String(evidence.artifactRef || "").toLowerCase();
  const notes = String(evidence.notes || "").toLowerCase();
  if (ref.includes("fixture") || ref.includes("placeholder") || notes.includes("fixture ridge")) {
    return {
      ok: false,
      reason: "fixture-artifact",
      message: "Fixture ridge artifacts cannot masquerade as trained production models",
    };
  }
  return { ok: true };
}

/**
 * Evaluate promotion readiness without inventing evidence.
 * Never auto-promotes.
 */
export function evaluatePromotionReadiness(evidenceInput = {}) {
  const evidence = buildPromotionEvidence(evidenceInput);
  const blockers = [];

  if (autoPromoteAllowed()) {
    blockers.push(REASON_CODE.AUTO_PROMOTE_FORBIDDEN);
  }
  if (!evidence.modelId || !evidence.modelVersion) {
    blockers.push(REASON_CODE.MODEL_NOT_VALIDATED);
  }
  if (!evidence.artifactRef || !evidence.artifactContentHash) {
    blockers.push(REASON_CODE.ARTIFACT_HASH_MISMATCH);
  }
  if (!evidence.featureManifestId) {
    blockers.push(REASON_CODE.DATA_QUALITY_BLOCK);
  }
  const folds = assertWalkForwardFolds(evidence);
  if (!folds.ok) blockers.push(REASON_CODE.MODEL_NOT_VALIDATED);
  const fixture = assertNotFixtureArtifact(evidenceInput);
  if (!fixture.ok) blockers.push(REASON_CODE.ARTIFACT_HASH_MISMATCH);

  if (evidence.oosN == null || evidence.oosN <= 0) {
    return {
      ready: false,
      status: EVIDENCE_STATUS.OOS_DATA_PENDING,
      blockers: [...new Set(blockers.concat(REASON_CODE.INSUFFICIENT_OOS))],
      evidence,
      autoPromote: false,
      operatorDecisionRequired: true,
    };
  }

  if (blockers.length || evidence.mae == null || evidence.pairedErrorVsBaseline == null) {
    return {
      ready: false,
      status: EVIDENCE_STATUS.VALIDATION_PENDING,
      blockers: [...new Set(blockers)],
      evidence,
      autoPromote: false,
      operatorDecisionRequired: true,
    };
  }

  if (evidence.maturity !== MODEL_MATURITY.PROMOTION_CANDIDATE) {
    return {
      ready: false,
      status: EVIDENCE_STATUS.VALIDATION_PENDING,
      blockers: [`maturity-is-${evidence.maturity}`],
      evidence,
      autoPromote: false,
      operatorDecisionRequired: true,
    };
  }

  if (evidence.operatorDecision !== "APPROVE") {
    return {
      ready: false,
      status: EVIDENCE_STATUS.OPERATOR_PROMOTION_REQUIRED,
      blockers: [REASON_CODE.OPERATOR_PROMOTION_REQUIRED],
      evidence,
      autoPromote: false,
      operatorDecisionRequired: true,
    };
  }

  return {
    ready: true,
    status: EVIDENCE_STATUS.OPERATOR_PROMOTION_REQUIRED, // still requires human execute
    blockers: [],
    evidence,
    autoPromote: false,
    operatorDecisionRequired: true,
    note: "Technical evidence complete; operator must explicitly promote. Never auto-promote.",
  };
}
