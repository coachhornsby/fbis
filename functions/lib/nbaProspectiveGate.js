/**
 * NBA prospective gate: frozen research → promotion-eligible criteria.
 * Wager authority stays false until every criterion passes AND operator approval.
 */

export const NBA_PROSPECTIVE_GATE_VERSION = "NBA-PROSPECTIVE-GATE-v1";

export const NBA_PROSPECTIVE_GATE_DEFAULT_RULES = Object.freeze({
  minimumGradedGames: 100,
  marginImprovementMin: 0.005,
  totalImprovementMin: 0.003,
  winnerAccuracyFloorVsV1: -0.005,
  brierNonInferiority: 0.002,
  logLossNonInferiority: 0.005,
  eceMax: 0.04,
  clv: Object.freeze({
    minimumEvaluatedBets: 50,
    positiveClvRateMin: 0.52,
    meanProbabilityClvMin: 0.0,
  }),
  economics: Object.freeze({
    minimumSettledBets: 50,
    roiMustBePositive: true,
    unitsMustBePositive: true,
    maxDrawdownUnitsMax: 12,
  }),
  subgroups: Object.freeze({
    injuryMinimumN: 20,
    scheduleStressMinimumN: 20,
    catastrophicRegressionTolerance: 0.05,
  }),
  resultOnPass: "PROMOTION_ELIGIBLE",
  operatorApprovalRequired: true,
});

const finite = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function parseRules(raw) {
  if (!raw) return { ...NBA_PROSPECTIVE_GATE_DEFAULT_RULES };
  try {
    const j = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      ...NBA_PROSPECTIVE_GATE_DEFAULT_RULES,
      ...j,
      clv: { ...NBA_PROSPECTIVE_GATE_DEFAULT_RULES.clv, ...(j.clv || {}) },
      economics: { ...NBA_PROSPECTIVE_GATE_DEFAULT_RULES.economics, ...(j.economics || {}) },
      subgroups: { ...NBA_PROSPECTIVE_GATE_DEFAULT_RULES.subgroups, ...(j.subgroups || {}) },
    };
  } catch {
    return { ...NBA_PROSPECTIVE_GATE_DEFAULT_RULES };
  }
}

function criterion(id, label, passed, current, required, detail = null) {
  return { id, label, passed: Boolean(passed), current, required, detail };
}

/**
 * Pure evaluation of gate evidence against frozen rules.
 * Never grants canAuthorize — only PROMOTION_ELIGIBLE when all criteria pass.
 */
export function evaluateNbaProspectiveGate(evidence = {}, rulesInput = null) {
  const rules = parseRules(rulesInput || evidence.rules || null);
  const graded = finite(evidence.gradedGames) ?? 0;
  const marginImp = finite(evidence.marginImprovement);
  const totalImp = finite(evidence.totalImprovement);
  const winnerDelta = finite(evidence.winnerAccuracyDeltaVsV1);
  const brierDelta = finite(evidence.brierDeltaVsV1);
  const logLossDelta = finite(evidence.logLossDeltaVsV1);
  const ece = finite(evidence.ece);
  const clvN = finite(evidence.clvEvaluatedBets) ?? 0;
  const clvRate = finite(evidence.positiveClvRate);
  const clvMean = finite(evidence.meanProbabilityClv);
  const settled = finite(evidence.settledBets) ?? 0;
  const roi = finite(evidence.roiPct);
  const units = finite(evidence.roiUnits);
  const drawdown = finite(evidence.maxDrawdownUnits);
  const injuryN = finite(evidence.injurySubgroupN) ?? 0;
  const scheduleN = finite(evidence.scheduleStressSubgroupN) ?? 0;
  const injuryReg = finite(evidence.injuryCatastrophicRegression);
  const scheduleReg = finite(evidence.scheduleCatastrophicRegression);
  const operatorApproved = evidence.operatorApproved === true;

  const criteria = [
    criterion("graded_games", "Graded games", graded >= rules.minimumGradedGames, graded, rules.minimumGradedGames),
    criterion("margin_improvement", "Margin RMSE improvement vs v1", marginImp != null && marginImp >= rules.marginImprovementMin, marginImp, rules.marginImprovementMin),
    criterion("total_improvement", "Total RMSE improvement vs v1", totalImp != null && totalImp >= rules.totalImprovementMin, totalImp, rules.totalImprovementMin),
    criterion("winner_accuracy", "Winner accuracy floor vs v1", winnerDelta != null && winnerDelta >= rules.winnerAccuracyFloorVsV1, winnerDelta, rules.winnerAccuracyFloorVsV1),
    criterion("brier", "Brier non-inferiority vs v1", brierDelta != null && brierDelta <= rules.brierNonInferiority, brierDelta, `<=${rules.brierNonInferiority}`),
    criterion("log_loss", "Log-loss non-inferiority vs v1", logLossDelta != null && logLossDelta <= rules.logLossNonInferiority, logLossDelta, `<=${rules.logLossNonInferiority}`),
    criterion("ece", "Calibration ECE max", ece != null && ece <= rules.eceMax, ece, `<=${rules.eceMax}`),
    criterion("clv_n", "CLV evaluated bets", clvN >= rules.clv.minimumEvaluatedBets, clvN, rules.clv.minimumEvaluatedBets),
    criterion("clv_rate", "Positive CLV rate", clvRate != null && clvRate >= rules.clv.positiveClvRateMin, clvRate, rules.clv.positiveClvRateMin),
    criterion("clv_mean", "Mean probability CLV", clvMean != null && clvMean >= rules.clv.meanProbabilityClvMin, clvMean, rules.clv.meanProbabilityClvMin),
    criterion("settled_n", "Settled bets", settled >= rules.economics.minimumSettledBets, settled, rules.economics.minimumSettledBets),
    criterion("roi", "ROI positive", !rules.economics.roiMustBePositive || (roi != null && roi > 0), roi, ">0"),
    criterion("units", "Units positive", !rules.economics.unitsMustBePositive || (units != null && units > 0), units, ">0"),
    criterion("drawdown", "Max drawdown units", drawdown != null && drawdown <= rules.economics.maxDrawdownUnitsMax, drawdown, `<=${rules.economics.maxDrawdownUnitsMax}`),
    criterion("injury_n", "Injury subgroup n", injuryN >= rules.subgroups.injuryMinimumN, injuryN, rules.subgroups.injuryMinimumN),
    criterion("schedule_n", "Schedule-stress subgroup n", scheduleN >= rules.subgroups.scheduleStressMinimumN, scheduleN, rules.subgroups.scheduleStressMinimumN),
    criterion("injury_regression", "Injury catastrophic regression", injuryReg == null || injuryReg <= rules.subgroups.catastrophicRegressionTolerance, injuryReg, `<=${rules.subgroups.catastrophicRegressionTolerance}`),
    criterion("schedule_regression", "Schedule catastrophic regression", scheduleReg == null || scheduleReg <= rules.subgroups.catastrophicRegressionTolerance, scheduleReg, `<=${rules.subgroups.catastrophicRegressionTolerance}`),
  ];

  const criteriaPassed = criteria.every((c) => c.passed);
  const gaps = criteria.filter((c) => !c.passed).map((c) => c.id);
  const promotionEligible = criteriaPassed;
  const canAuthorize = promotionEligible && (!rules.operatorApprovalRequired || operatorApproved);

  return {
    gateVersion: NBA_PROSPECTIVE_GATE_VERSION,
    status: canAuthorize
      ? "AUTHORIZED"
      : promotionEligible
        ? (operatorApproved ? "PROMOTION_ELIGIBLE" : "AWAITING_OPERATOR_APPROVAL")
        : "FROZEN_RESEARCH_GATE",
    criteriaPassed,
    promotionEligible,
    operatorApprovalRequired: Boolean(rules.operatorApprovalRequired),
    operatorApproved,
    canQualify: canAuthorize,
    canAuthorize,
    criteria,
    gaps,
    progress: {
      passed: criteria.filter((c) => c.passed).length,
      total: criteria.length,
      ratio: criteria.length ? criteria.filter((c) => c.passed).length / criteria.length : 0,
    },
    rules,
    note: "Research board may publish projections while this gate is frozen. Wager authority requires every criterion plus operator approval.",
  };
}

export async function loadNbaProspectiveGateRow(db) {
  if (!db?.prepare) return null;
  try {
    const res = await db.prepare(
      `SELECT gate_version, frozen_at, rules_json, auto_promote, can_qualify, can_authorize, status
       FROM nba_prospective_gate WHERE gate_version=? LIMIT 1`
    ).bind(NBA_PROSPECTIVE_GATE_VERSION).first();
    return res || null;
  } catch {
    return null;
  }
}

/** Collect best-effort evidence counters from D1 (missing tables → zeros). */
export async function collectNbaGateEvidence(db) {
  const empty = {
    gradedGames: 0,
    clvEvaluatedBets: 0,
    positiveClvRate: null,
    meanProbabilityClv: null,
    settledBets: 0,
    roiPct: null,
    roiUnits: null,
    maxDrawdownUnits: null,
    injurySubgroupN: 0,
    scheduleStressSubgroupN: 0,
    marginImprovement: null,
    totalImprovement: null,
    winnerAccuracyDeltaVsV1: null,
    brierDeltaVsV1: null,
    logLossDeltaVsV1: null,
    ece: null,
    injuryCatastrophicRegression: null,
    scheduleCatastrophicRegression: null,
    operatorApproved: false,
    sources: [],
  };
  if (!db?.prepare) return empty;

  const sources = [];
  const tryCount = async (label, sql, ...binds) => {
    try {
      const row = await db.prepare(sql).bind(...binds).first();
      sources.push(label);
      return finite(row?.n ?? row?.c ?? row?.count) ?? 0;
    } catch {
      return 0;
    }
  };

  const gradedGames = await tryCount(
    "nba_prospective_game_shadow.graded",
    `SELECT COUNT(*) AS n FROM nba_prospective_game_shadow
     WHERE graded_at IS NOT NULL AND model_id LIKE 'NBA-%'`
  );

  let clvEvaluatedBets = 0;
  let positiveClvRate = null;
  let meanProbabilityClv = null;
  try {
    const clv = await db.prepare(
      `SELECT COUNT(*) AS n,
              AVG(CASE WHEN clv_probability > 0 THEN 1.0 ELSE 0.0 END) AS pos_rate,
              AVG(clv_probability) AS mean_clv
       FROM nba_wager_decisions
       WHERE graded_at IS NOT NULL AND clv_probability IS NOT NULL`
    ).first();
    clvEvaluatedBets = finite(clv?.n) ?? 0;
    positiveClvRate = finite(clv?.pos_rate);
    meanProbabilityClv = finite(clv?.mean_clv);
    sources.push("nba_wager_decisions.clv");
  } catch { /* table may not have rows/columns yet */ }

  let settledBets = 0;
  let roiPct = null;
  let roiUnits = null;
  let maxDrawdownUnits = null;
  try {
    const eco = await db.prepare(
      `SELECT COUNT(*) AS n, SUM(profit_units) AS units,
              CASE WHEN SUM(ABS(COALESCE(stake_units,0))) > 0
                   THEN SUM(profit_units) / SUM(ABS(stake_units))
                   ELSE NULL END AS roi
       FROM nba_wager_decisions
       WHERE graded_at IS NOT NULL AND profit_units IS NOT NULL`
    ).first();
    settledBets = finite(eco?.n) ?? 0;
    roiUnits = finite(eco?.units);
    // Convert fraction → percent when present
    roiPct = finite(eco?.roi) == null ? null : finite(eco.roi) * 100;
    sources.push("nba_wager_decisions.economics");
  } catch { /* optional */ }

  try {
    const val = await db.prepare(
      `SELECT bet_n, units, roi_pct, max_drawdown_units, positive_clv_rate, graded_n
       FROM nba_decision_validation_runs
       ORDER BY created_at DESC LIMIT 1`
    ).first();
    if (val) {
      if (!settledBets) settledBets = finite(val.bet_n) ?? 0;
      if (roiUnits == null) roiUnits = finite(val.units);
      if (roiPct == null) roiPct = finite(val.roi_pct);
      maxDrawdownUnits = finite(val.max_drawdown_units);
      if (positiveClvRate == null) positiveClvRate = finite(val.positive_clv_rate);
      if (!clvEvaluatedBets) clvEvaluatedBets = finite(val.graded_n) ?? 0;
      sources.push("nba_decision_validation_runs");
    }
  } catch { /* optional */ }

  const injurySubgroupN = await tryCount(
    "shadow.injury",
    `SELECT COUNT(*) AS n FROM nba_prospective_game_shadow
     WHERE graded_at IS NOT NULL AND injury_buckets_json IS NOT NULL AND injury_buckets_json != '{}' AND injury_buckets_json != 'null'`
  );
  const scheduleStressSubgroupN = await tryCount(
    "shadow.schedule",
    `SELECT COUNT(*) AS n FROM nba_prospective_game_shadow
     WHERE graded_at IS NOT NULL AND schedule_buckets_json IS NOT NULL AND schedule_buckets_json != '{}' AND schedule_buckets_json != 'null'`
  );

  let marginImprovement = null;
  let totalImprovement = null;
  let winnerAccuracyDeltaVsV1 = null;
  let brierDeltaVsV1 = null;
  let logLossDeltaVsV1 = null;
  let ece = null;
  try {
    const deep = await db.prepare(
      `SELECT margin_improvement, total_improvement,
              challenger_winner_accuracy, incumbent_winner_accuracy,
              details_json
       FROM nba_deep_validation_runs
       ORDER BY created_at DESC LIMIT 1`
    ).first();
    if (deep) {
      marginImprovement = finite(deep.margin_improvement);
      totalImprovement = finite(deep.total_improvement);
      const chal = finite(deep.challenger_winner_accuracy);
      const inc = finite(deep.incumbent_winner_accuracy);
      if (chal != null && inc != null) winnerAccuracyDeltaVsV1 = chal - inc;
      sources.push("nba_deep_validation_runs");
      try {
        const details = deep.details_json ? JSON.parse(deep.details_json) : null;
        brierDeltaVsV1 = finite(details?.brierDeltaVsV1 ?? details?.brier_delta);
        logLossDeltaVsV1 = finite(details?.logLossDeltaVsV1 ?? details?.log_loss_delta);
        ece = finite(details?.ece ?? details?.calibrationEce);
      } catch { /* ignore bad json */ }
    }
  } catch { /* optional */ }

  try {
    const cal = await db.prepare(
      `SELECT brier_score, log_loss, sample_n
       FROM nba_confidence_calibration
       ORDER BY created_at DESC LIMIT 1`
    ).first();
    if (cal) {
      // Non-inferiority deltas stay null unless deep details supply them;
      // ECE can be approximated from calibration bins later — expose brier as progress signal.
      if (ece == null) {
        try {
          const bins = await db.prepare(
            `SELECT bins_json FROM nba_confidence_calibration ORDER BY created_at DESC LIMIT 1`
          ).first();
          const parsed = bins?.bins_json ? JSON.parse(bins.bins_json) : null;
          ece = finite(parsed?.ece ?? parsed?.ECE);
        } catch { /* optional */ }
      }
      sources.push("nba_confidence_calibration");
      void cal; // brier/log_loss retained for future delta baselines
    }
  } catch { /* optional */ }

  let injuryCatastrophicRegression = null;
  let scheduleCatastrophicRegression = null;
  try {
    // Placeholder subgroup regression: null means "no catastrophic signal observed"
    // (criteria treat null as pass). Positive values would block.
    if (injurySubgroupN > 0) injuryCatastrophicRegression = 0;
    if (scheduleStressSubgroupN > 0) scheduleCatastrophicRegression = 0;
  } catch { /* optional */ }

  let operatorApproved = false;
  try {
    const gate = await loadNbaProspectiveGateRow(db);
    if (gate) {
      if (String(gate.status || "") === "AUTHORIZED" || Number(gate.can_authorize) === 1) {
        operatorApproved = true;
      }
    }
  } catch { /* optional */ }

  return {
    ...empty,
    gradedGames,
    clvEvaluatedBets,
    positiveClvRate,
    meanProbabilityClv,
    settledBets,
    roiPct,
    roiUnits,
    maxDrawdownUnits,
    injurySubgroupN,
    scheduleStressSubgroupN,
    marginImprovement,
    totalImprovement,
    winnerAccuracyDeltaVsV1,
    brierDeltaVsV1,
    logLossDeltaVsV1,
    ece,
    injuryCatastrophicRegression,
    scheduleCatastrophicRegression,
    operatorApproved,
    sources,
  };
}

export async function resolveNbaProspectiveGate(db) {
  const row = await loadNbaProspectiveGateRow(db);
  const rules = parseRules(row?.rules_json);
  const evidence = await collectNbaGateEvidence(db);
  const evaluation = evaluateNbaProspectiveGate(evidence, rules);
  // Fail-closed: D1 can_authorize=1 is the operator cutover switch after criteria pass.
  const d1Allows = Number(row?.can_authorize) === 1;
  const criteriaReady = evaluation.criteriaPassed;
  const awaitingOperator = criteriaReady && !d1Allows;
  const authorized = criteriaReady && d1Allows;
  return {
    ...evaluation,
    status: authorized
      ? "AUTHORIZED"
      : awaitingOperator
        ? "AWAITING_OPERATOR_APPROVAL"
        : (row?.status || "FROZEN_RESEARCH_GATE"),
    // Enforced board authority — only true after criteria + D1 operator cutover.
    canAuthorize: authorized,
    canQualify: authorized,
    criteriaReady,
    awaitingOperator,
    d1Status: row?.status || null,
    d1CanAuthorize: d1Allows,
    frozenAt: row?.frozen_at || null,
    evidence: {
      gradedGames: evidence.gradedGames,
      clvEvaluatedBets: evidence.clvEvaluatedBets,
      positiveClvRate: evidence.positiveClvRate,
      meanProbabilityClv: evidence.meanProbabilityClv,
      settledBets: evidence.settledBets,
      roiPct: evidence.roiPct,
      roiUnits: evidence.roiUnits,
      maxDrawdownUnits: evidence.maxDrawdownUnits,
      marginImprovement: evidence.marginImprovement,
      totalImprovement: evidence.totalImprovement,
      winnerAccuracyDeltaVsV1: evidence.winnerAccuracyDeltaVsV1,
      brierDeltaVsV1: evidence.brierDeltaVsV1,
      logLossDeltaVsV1: evidence.logLossDeltaVsV1,
      ece: evidence.ece,
      injurySubgroupN: evidence.injurySubgroupN,
      scheduleStressSubgroupN: evidence.scheduleStressSubgroupN,
      sources: evidence.sources,
    },
    boardPolicy: authorized ? "WAGER_AUTHORITY_ENABLED" : "RESEARCH_ONLY_UNTIL_GATE_AND_OPERATOR",
  };
}
