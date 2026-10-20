/**
 * CFB CORE research promotion gates.
 * Passing these gates only yields PROMOTION_ELIGIBLE_PENDING_OPERATOR.
 * Auto-promote is permanently disabled. Champion remains authoritative.
 */
import {PROMOTION_CRITERIA} from "./collegeModels.js";
import {CFB_CORE_SHADOW_ID} from "./cfbCoreChallenger.js";

export const CFB_CORE_PROMOTION_GATE_V1 = Object.freeze({
  gateVersion: "CFB-CORE-PROMOTION-GATE-v1",
  autoPromote: false,
  canQualify: false,
  canAuthorize: false,
  operatorApprovalRequired: true,
  rules: Object.freeze({
    ...PROMOTION_CRITERIA,
    minFolds: 2,
    requirePitHistoricalCore: true,
    requireMultiSeasonOos: true,
    minMaeImprovementMargin: PROMOTION_CRITERIA.minMaeImprovement,
    minMaeImprovementTotal: PROMOTION_CRITERIA.minMaeImprovement,
    requireMarketRelativeImprovement: true,
    requirePositiveNetEvWithUncertainty: true,
    requireProspectiveShadowConsistent: true,
    requireNoIntegrityViolations: true,
    neverEvidence: Object.freeze([
      "one good week",
      "small historical sample",
      "disagreement alone",
      "current Week-6 CORE treated as Week-7",
      "unverified fitted artifact",
    ]),
    resultOnPass: "PROMOTION_ELIGIBLE_PENDING_OPERATOR",
  }),
});

/**
 * Evaluate whether CORE research evidence is eligible for an operator promotion proposal.
 * Never auto-promotes. Never authorizes wagers.
 */
export function evaluateCfbCorePromotion(evidence = {}) {
  const rules = CFB_CORE_PROMOTION_GATE_V1.rules;
  const fail = [];
  const n = Number(evidence.oosN || 0);
  const seasons = Number(evidence.seasons || 0);
  const folds = Number(evidence.folds || 0);
  const marginImp = Number(evidence.marginMaeImprovement);
  const totalImp = Number(evidence.totalMaeImprovement);
  const biasAbs = Number(evidence.biasAbs);
  const brierDeg = Number(evidence.brierDegradation);
  const coverage = Number(evidence.coverage);
  const marketImproved = evidence.marketRelativeImproved === true;
  const netEvPositive = evidence.netEvPositive === true;
  const prospectiveOk = evidence.prospectiveConsistent === true;
  const integrityOk = evidence.integrityOk === true;
  const pitOk = evidence.pitHistoricalCore === true;
  const artifactOk = evidence.artifactOk === true;
  const operatorApproved = evidence.operatorApproved === true;

  if (n < rules.minOosN) fail.push(`oos-n ${n} < ${rules.minOosN}`);
  if (seasons < rules.minSeasons) fail.push(`seasons ${seasons} < ${rules.minSeasons}`);
  if (folds < rules.minFolds) fail.push(`folds ${folds} < ${rules.minFolds}`);
  if (!pitOk) fail.push("pit-historical-core-required");
  if (!Number.isFinite(marginImp) || marginImp < rules.minMaeImprovementMargin) fail.push("margin-mae-improvement");
  if (!Number.isFinite(totalImp) || totalImp < rules.minMaeImprovementTotal) fail.push("total-mae-improvement");
  if (!Number.isFinite(biasAbs) || biasAbs > rules.maxBiasAbs) fail.push("bias");
  if (!Number.isFinite(brierDeg) || brierDeg > rules.maxBrierDegradation) fail.push("brier-degradation");
  if (!Number.isFinite(coverage) || coverage < rules.minCoverage) fail.push("coverage");
  if (!marketImproved) fail.push("market-relative-improvement");
  if (!netEvPositive) fail.push("net-ev-with-uncertainty");
  if (!prospectiveOk) fail.push("prospective-shadow-consistency");
  if (!integrityOk) fail.push("integrity-violations");
  if (!artifactOk) fail.push("reproducible-artifact");
  if (!operatorApproved) fail.push("operator-approval-required");

  const eligible = fail.length === 0;
  return {
    modelId: CFB_CORE_SHADOW_ID,
    gateVersion: CFB_CORE_PROMOTION_GATE_V1.gateVersion,
    promote: false, // never auto-promote
    promotionEligiblePendingOperator: eligible,
    decision: eligible
      ? "PROMOTION_ELIGIBLE_PENDING_OPERATOR"
      : "RETAIN_CHAMPION_RESEARCH_ONLY",
    fail,
    rules,
    autoPromote: false,
    canQualify: false,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
    residualRisks: evidence.residualRisks || [
      "Operator must re-verify PIT coverage and prospective shadow before any champion change.",
    ],
  };
}
