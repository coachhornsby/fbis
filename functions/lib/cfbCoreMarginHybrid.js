/**
 * Margin-only CORE hybrid (leading research candidate).
 *
 * Two variants:
 *   1) model_c_margin_aa_total (LEADING empirical on historical holdout):
 *        Fit Model C margin ridge on combined features (2025).
 *        Apply: margin = f(A/A baseline features + CORE); total = A/A total.
 *   2) margin_residual_aa_total (mismatch-robust sensitivity):
 *        Fit residual r = actual − baselineMargin ~ ridge(CORE crosses only).
 *        Apply: margin = A/A margin + r̂(CORE); total = A/A total.
 *
 * Total MAE is unchanged by construction for both — that is not a totals win.
 * Research-only. Never auto-promotes. Never authorizes wagers.
 */

import { fitRidge, predictRidge, mae } from "./cfbFbisV2Fit.js";
import { CFB_CORE_FEATURE_KEYS } from "./cfbCoreChallenger.js";

export const CFB_CORE_MARGIN_HYBRID_ID = "CFB-CORE-MARGIN-HYBRID-v1";
export const CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING = "model_c_margin_aa_total";
export const CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL = "margin_residual_aa_total";
/** @deprecated prefer CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING */
export const CFB_CORE_MARGIN_HYBRID_VARIANT = CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING;
export const MARGIN_RESIDUAL_FEATURE_KEYS = Object.freeze([
  "coreCrossMargin",
  "coreCrossTotal",
]);

const ROUND = (x, d = 4) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);
const n = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function scoresFromMarginTotal(margin, total) {
  const home = (total + margin) / 2;
  const away = (total - margin) / 2;
  return { home, away, margin, total };
}

export function describeCfbCoreMarginHybrid() {
  return {
    modelId: CFB_CORE_MARGIN_HYBRID_ID,
    leadingVariant: CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING,
    residualVariant: CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL,
    leadingResearchCandidate: true,
    replacesFullScoreProjection: false,
    totalMaeUnchangedByConstruction: true,
    meaningfulGain: "margin_mae_reduction_vs_raw_production_aa",
    leadingApplyFormula:
      "hybridMargin = ModelC_margin(A/A baseline features + CORE); hybridTotal = productionAaTotal",
    residualApplyFormula:
      "hybridMargin = productionAaMargin + residual(CORE crosses); hybridTotal = productionAaTotal",
    mismatchMitigation: {
      leading:
        "At apply time baseline feature slots are filled with production A/A (not Elo). Train used Elo in those slots — covariate shift remains on baseline features; CORE slots are consistent.",
      residual:
        "Residual features are CORE-only; Elo never enters apply-time scoring. Historically weaker than leading on the 149-game holdout.",
    },
    caution:
      "Do not cite unchanged total MAE as evidence of an improved totals model — it is guaranteed by construction.",
    authority: "research_only",
    canAuthorizeWager: false,
    canInfluenceProduction: false,
    autoPromote: false,
  };
}

/**
 * Leading empirical artifact: Model C margin ridge on combined features.
 * Totals are never predicted — always copied from production A/A at apply.
 */
export function fitModelCMarginAaTotalArtifact(
  trainRows = [],
  { lambda = 1, lastTrainingSeason = 2025 } = {}
) {
  const xs = [];
  const ys = [];
  let skipped = 0;
  for (const r of trainRows) {
    const x = Array.isArray(r.xCombined) ? r.xCombined : null;
    const y = n(r.actualMargin);
    if (!x || x.length !== CFB_CORE_FEATURE_KEYS.length || !x.every(Number.isFinite) || y == null) {
      skipped += 1;
      continue;
    }
    xs.push(x);
    ys.push(y);
  }
  if (xs.length < 40) {
    return { ok: false, reason: "insufficient_train_rows", n: xs.length, skipped };
  }
  const fit = fitRidge(xs, ys, {
    lambda,
    featureNames: [...CFB_CORE_FEATURE_KEYS],
  });
  return {
    ok: true,
    modelId: CFB_CORE_MARGIN_HYBRID_ID,
    variant: CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING,
    version: "research-margin-hybrid-modelc-v1",
    verifiedOos: true,
    lastTrainingSeason,
    features: [...CFB_CORE_FEATURE_KEYS],
    margin: {
      intercept: fit.intercept,
      beta: fit.beta,
      means: fit.means,
      stds: fit.stds,
      lambda,
      featureNames: [...CFB_CORE_FEATURE_KEYS],
    },
    // residual slot unused for leading variant
    residual: null,
    total: {
      mode: "identity_production_aa_total",
      intercept: 0,
      beta: [0, 0, 0, 0],
      means: [0, 0, 0, 0],
      stds: [1, 1, 1, 1],
    },
    trainN: xs.length,
    skipped,
    authority: "research_only",
    canInfluenceProduction: false,
    canAuthorizeWager: false,
    note: "Coefficients frozen from train season only; never refit on holdout/prospective labels. Total always from production A/A.",
  };
}

function residualX(row) {
  const f = row.vector?.features || row.features || {};
  // Prefer explicit combined vector indices if present
  if (Array.isArray(row.xCombined) && row.xCombined.length >= 4) {
    return [row.xCombined[2], row.xCombined[3]];
  }
  return [n(f.coreCrossMargin), n(f.coreCrossTotal)];
}

function baselineMarginOf(row) {
  if (Number.isFinite(n(row.baselineHome)) && Number.isFinite(n(row.baselineAway))) {
    return n(row.baselineHome) - n(row.baselineAway);
  }
  const f = row.vector?.features || {};
  return n(f.baselineMargin);
}

function baselineTotalOf(row) {
  if (Number.isFinite(n(row.baselineHome)) && Number.isFinite(n(row.baselineAway))) {
    return n(row.baselineHome) + n(row.baselineAway);
  }
  const f = row.vector?.features || {};
  return n(f.baselineTotal);
}

/**
 * Fit residual ridge on train rows. Never looks at evaluate-season labels.
 */
export function fitMarginResidualArtifact(trainRows = [], { lambda = 1, lastTrainingSeason = 2025 } = {}) {
  const xs = [];
  const ys = [];
  let skipped = 0;
  for (const r of trainRows) {
    const x = residualX(r);
    const baseM = baselineMarginOf(r);
    const actualM = n(r.actualMargin);
    if (!x.every(Number.isFinite) || baseM == null || actualM == null) {
      skipped += 1;
      continue;
    }
    xs.push(x);
    ys.push(actualM - baseM);
  }
  if (xs.length < 40) {
    return {
      ok: false,
      reason: "insufficient_train_rows",
      n: xs.length,
      skipped,
    };
  }
  const fit = fitRidge(xs, ys, {
    lambda,
    featureNames: [...MARGIN_RESIDUAL_FEATURE_KEYS],
  });
  return {
    ok: true,
    modelId: CFB_CORE_MARGIN_HYBRID_ID,
    variant: CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL,
    version: "research-margin-hybrid-residual-v1",
    verifiedOos: true,
    lastTrainingSeason,
    features: [...MARGIN_RESIDUAL_FEATURE_KEYS],
    residual: {
      intercept: fit.intercept,
      beta: fit.beta,
      means: fit.means,
      stds: fit.stds,
      lambda,
      featureNames: [...MARGIN_RESIDUAL_FEATURE_KEYS],
    },
    margin: null,
    // Placeholder total model: identity on A/A total (not used for fitting)
    total: {
      mode: "identity_production_aa_total",
      intercept: 0,
      beta: [0, 0],
      means: [0, 0],
      stds: [1, 1],
    },
    trainN: xs.length,
    skipped,
    authority: "research_only",
    canInfluenceProduction: false,
    canAuthorizeWager: false,
    note: "Mismatch-robust sensitivity artifact. Coefficients frozen from train season only; never refit on holdout/prospective labels.",
  };
}

export function predictMarginResidual(artifact, rowOrFeatures) {
  if (!artifact?.ok && !artifact?.residual) return null;
  const residual = artifact.residual || artifact;
  const x = Array.isArray(rowOrFeatures)
    ? rowOrFeatures
    : residualX(rowOrFeatures);
  if (!x.every(Number.isFinite)) return null;
  const preds = predictRidge(
    {
      intercept: residual.intercept,
      beta: residual.beta,
      means: residual.means,
      stds: residual.stds,
    },
    [x]
  );
  return preds[0];
}

function combinedXWithAaBaseline(row, aaHome, aaAway) {
  const f = row.vector?.features || row.features || {};
  const coreM = Array.isArray(row.xCombined) ? n(row.xCombined[2]) : n(f.coreCrossMargin);
  const coreT = Array.isArray(row.xCombined) ? n(row.xCombined[3]) : n(f.coreCrossTotal);
  return [aaHome - aaAway, aaHome + aaAway, coreM, coreT];
}

/**
 * Apply frozen margin-hybrid artifact + production A/A baseline scores.
 * Supports leading (Model C margin) and residual variants.
 */
export function projectCfbCoreMarginHybrid(row, artifact, { aaHome = null, aaAway = null } = {}) {
  const design = describeCfbCoreMarginHybrid();
  const home = n(aaHome ?? row.baselineHome);
  const away = n(aaAway ?? row.baselineAway);
  if (home == null || away == null) {
    return {
      ok: false,
      reason: "PRODUCTION_AA_BASELINE_REQUIRED",
      ...design,
    };
  }
  const variant = artifact?.variant || null;
  const isLeading = variant === CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING && artifact?.margin;
  const isResidual = variant === CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL && artifact?.residual;
  if (!isLeading && !isResidual) {
    return {
      ok: false,
      reason: "MARGIN_HYBRID_ARTIFACT_UNVERIFIED",
      ...design,
    };
  }
  if (
    Number.isInteger(artifact.lastTrainingSeason) &&
    Number.isInteger(n(row.season)) &&
    artifact.lastTrainingSeason >= n(row.season)
  ) {
    return {
      ok: false,
      reason: "ARTIFACT_TRAINING_CUTOFF_NOT_BEFORE_TARGET_SEASON",
      ...design,
    };
  }

  const aaMargin = home - away;
  const aaTotal = home + away;
  let margin;
  let residual = null;
  if (isLeading) {
    const x = combinedXWithAaBaseline(row, home, away);
    if (!x.every(Number.isFinite)) {
      return { ok: false, reason: "COMBINED_FEATURES_INVALID", ...design };
    }
    const preds = predictRidge(
      {
        intercept: artifact.margin.intercept,
        beta: artifact.margin.beta,
        means: artifact.margin.means,
        stds: artifact.margin.stds,
      },
      [x]
    );
    margin = preds[0];
  } else {
    residual = predictMarginResidual(artifact, row);
    if (!Number.isFinite(residual)) {
      return { ok: false, reason: "RESIDUAL_PREDICTION_INVALID", ...design };
    }
    margin = aaMargin + residual;
  }
  const total = aaTotal;
  if (!Number.isFinite(margin) || total <= 0 || Math.abs(margin) > total + 1) {
    return { ok: false, reason: "HYBRID_SCORE_INVALID", ...design };
  }
  const scores = scoresFromMarginTotal(margin, total);
  return {
    ok: true,
    modelId: CFB_CORE_MARGIN_HYBRID_ID,
    variant,
    version: artifact.version || "research-margin-hybrid-v1",
    home: scores.home,
    away: scores.away,
    margin: scores.margin,
    total: scores.total,
    residual,
    aaHome: home,
    aaAway: away,
    aaMargin,
    aaTotal,
    sourceArtifact: artifact.artifactId || null,
    authority: "research_only",
    canQualify: false,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
    totalUnchangedVsAa: true,
    explanation: isLeading
      ? "Model C margin with production A/A baseline features + CORE; total copied from A/A unchanged"
      : "CORE residual margin added to frozen production A/A; total copied from A/A unchanged",
  };
}

export function marginHybridPredictionsForRows(rows, artifact) {
  return rows.map((r) => {
    const p = projectCfbCoreMarginHybrid(r, artifact);
    if (!p.ok) {
      return { home: NaN, away: NaN, margin: NaN, total: NaN, ok: false, reason: p.reason };
    }
    return {
      home: p.home,
      away: p.away,
      margin: p.margin,
      total: p.total,
      residual: p.residual,
      source: CFB_CORE_MARGIN_HYBRID_VARIANT,
      ok: true,
    };
  });
}

/**
 * Explicit promotion thresholds for margin-only hybrid.
 * Total MAE improvement is a non-regression gate (Δ <= 0), not a gain requirement —
 * because hybrid total ≡ A/A total by construction.
 */
export const CFB_CORE_MARGIN_HYBRID_PROMOTION_GATE_V1 = Object.freeze({
  gateVersion: "CFB-CORE-MARGIN-HYBRID-GATE-v1",
  autoPromote: false,
  canQualify: false,
  canAuthorize: false,
  operatorApprovalRequired: true,
  appliesTo: CFB_CORE_MARGIN_HYBRID_ID,
  rules: Object.freeze({
    minProspectiveOosN: 200,
    minHistoricalHoldoutN: 100,
    minSeasonsProspective: 1,
    // Margin: require improvement vs raw A/A
    minMarginMaeImprovement: 0.25, // points MAE reduction
    requireMarginMaeCiExcludesZero: true,
    // Total: non-regression only (by construction hybrid total = A/A)
    maxTotalMaeRegression: 0.0,
    // Winner accuracy: no hard floor, but forbid large regression
    maxWinnerAccuracyRegression: 0.02,
    // Calibration of margin residuals
    maxMarginBiasAbs: 1.5,
    maxMarginResidualMae: 14.0,
    // Sample / process
    requireWeekClusteredBootstrap: true,
    requireProspectiveFrozenNoRetune: true,
    requireTrainEvalBaselineMismatchDocumented: true,
    requireNoHoldoutRetune: true,
    requireOperatorApproval: true,
    neverEvidence: Object.freeze([
      "holdout retune after seeing 149-game results",
      "total MAE 'improvement' claimed for hybrid (construction artifact)",
      "iid bootstrap alone without week-clustered check",
      "Elo-proxy treated as production A/A",
    ]),
    resultOnPass: "PROMOTION_ELIGIBLE_PENDING_OPERATOR",
  }),
});

export function evaluateMarginHybridPromotion(evidence = {}) {
  const rules = CFB_CORE_MARGIN_HYBRID_PROMOTION_GATE_V1.rules;
  const fail = [];
  const histN = Number(evidence.historicalHoldoutN || 0);
  const prospN = Number(evidence.prospectiveOosN || 0);
  const marginImp = Number(evidence.marginMaeImprovement);
  const totalReg = Number(evidence.totalMaeRegression); // hybrid − aa; should be ~0
  const winnerReg = Number(evidence.winnerAccuracyRegression); // aa − hybrid (positive = hybrid worse)
  const biasAbs = Number(evidence.marginBiasAbs);
  const ciExcludesZero = evidence.marginMaeCiExcludesZero === true;
  const weekClustered = evidence.weekClusteredBootstrap === true;
  const prospectiveFrozen = evidence.prospectiveFrozenNoRetune === true;
  const mismatchDocumented = evidence.trainEvalBaselineMismatchDocumented === true;
  const noHoldoutRetune = evidence.noHoldoutRetune === true;
  const operatorApproved = evidence.operatorApproved === true;

  if (histN < rules.minHistoricalHoldoutN) {
    fail.push(`historical-holdout-n ${histN} < ${rules.minHistoricalHoldoutN}`);
  }
  if (prospN < rules.minProspectiveOosN) {
    fail.push(`prospective-oos-n ${prospN} < ${rules.minProspectiveOosN}`);
  }
  if (!Number.isFinite(marginImp) || marginImp < rules.minMarginMaeImprovement) {
    fail.push("margin-mae-improvement");
  }
  if (rules.requireMarginMaeCiExcludesZero && !ciExcludesZero) {
    fail.push("margin-mae-ci-must-exclude-zero");
  }
  if (!Number.isFinite(totalReg) || totalReg > rules.maxTotalMaeRegression + 1e-9) {
    fail.push("total-mae-regression");
  }
  if (!Number.isFinite(winnerReg) || winnerReg > rules.maxWinnerAccuracyRegression) {
    fail.push("winner-accuracy-regression");
  }
  if (!Number.isFinite(biasAbs) || biasAbs > rules.maxMarginBiasAbs) {
    fail.push("margin-bias");
  }
  if (rules.requireWeekClusteredBootstrap && !weekClustered) {
    fail.push("week-clustered-bootstrap-required");
  }
  if (rules.requireProspectiveFrozenNoRetune && !prospectiveFrozen) {
    fail.push("prospective-frozen-no-retune");
  }
  if (rules.requireTrainEvalBaselineMismatchDocumented && !mismatchDocumented) {
    fail.push("train-eval-baseline-mismatch-undocumented");
  }
  if (rules.requireNoHoldoutRetune && !noHoldoutRetune) {
    fail.push("holdout-retune-forbidden");
  }
  if (rules.requireOperatorApproval && !operatorApproved) {
    fail.push("operator-approval-required");
  }

  const eligible = fail.length === 0;
  return {
    modelId: CFB_CORE_MARGIN_HYBRID_ID,
    gateVersion: CFB_CORE_MARGIN_HYBRID_PROMOTION_GATE_V1.gateVersion,
    promote: false,
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
    caution:
      "Hybrid total MAE equals raw A/A by construction; do not treat total MAE parity as evidence of a better totals model. The empirical claim is margin MAE reduction only.",
  };
}

export function residualTrainMetrics(trainRows, artifact) {
  const errs = [];
  const biases = [];
  for (const r of trainRows) {
    const baseM = baselineMarginOf(r);
    const actualM = n(r.actualMargin);
    const rHat = predictMarginResidual(artifact, r);
    if (baseM == null || actualM == null || !Number.isFinite(rHat)) continue;
    const pred = baseM + rHat;
    errs.push(Math.abs(pred - actualM));
    biases.push(pred - actualM);
  }
  return {
    n: errs.length,
    marginMae: ROUND(errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null),
    marginBias: ROUND(biases.length ? biases.reduce((a, b) => a + b, 0) / biases.length : null),
  };
}

export { baselineMarginOf, baselineTotalOf, residualX, mae };
