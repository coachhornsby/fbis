/**
 * NBA prospective gate: frozen research → promotion-eligible criteria.
 * Wager authority stays false until every criterion passes AND operator approval.
 *
 * Integrity rules:
 * - Graded-game counts are DISTINCT game_id (models × game do not inflate n).
 * - Missing subgroup regression evidence fails (never treated as pass/zero).
 * - Economic/CLV criteria use only prospective wager-decision ledger rows with
 *   point-in-time provenance (feature cutoff ≤ decision ≤ tipoff ≤ grade) —
 *   research validation / deep holdout runs are informational, never substitutes.
 */

/** SQL predicate fragment: wager decision joined to projection with PIT provenance. */
export const NBA_PROSPECTIVE_PIT_JOIN = `
  FROM nba_wager_decisions d
  INNER JOIN nba_game_projections p ON p.id = d.projection_id
  WHERE d.graded_at IS NOT NULL
    AND d.decision_timestamp IS NOT NULL
    AND p.tipoff_timestamp IS NOT NULL
    AND p.feature_cutoff_timestamp IS NOT NULL
    AND datetime(p.feature_cutoff_timestamp) <= datetime(d.decision_timestamp)
    AND datetime(d.decision_timestamp) <= datetime(p.tipoff_timestamp)
    AND datetime(d.decision_timestamp) <= datetime(d.graded_at)
`;

/**
 * Pure PIT provenance check for a wager decision + linked projection.
 * Used by collectors and unit tests — missing tipoff/cutoff fails closed.
 */
export function isProspectivePitWagerEvidence(decision = {}, projection = {}) {
  const decisionTs = Date.parse(String(decision.decision_timestamp || decision.decisionTimestamp || ""));
  const gradedAt = Date.parse(String(decision.graded_at || decision.gradedAt || ""));
  const tipoff = Date.parse(String(projection.tipoff_timestamp || projection.tipoffTimestamp || ""));
  const cutoff = Date.parse(String(projection.feature_cutoff_timestamp || projection.featureCutoffTimestamp || ""));
  if (![decisionTs, gradedAt, tipoff, cutoff].every(Number.isFinite)) {
    return {
      ok: false,
      reason: "missing_pit_timestamps",
      decisionTs: Number.isFinite(decisionTs) ? decisionTs : null,
      gradedAt: Number.isFinite(gradedAt) ? gradedAt : null,
      tipoff: Number.isFinite(tipoff) ? tipoff : null,
      featureCutoff: Number.isFinite(cutoff) ? cutoff : null,
    };
  }
  if (cutoff > decisionTs) return { ok: false, reason: "feature_cutoff_after_decision", decisionTs, gradedAt, tipoff, featureCutoff: cutoff };
  if (decisionTs > tipoff) return { ok: false, reason: "decision_after_tipoff", decisionTs, gradedAt, tipoff, featureCutoff: cutoff };
  if (decisionTs > gradedAt) return { ok: false, reason: "decision_after_grade", decisionTs, gradedAt, tipoff, featureCutoff: cutoff };
  return { ok: true, reason: null, decisionTs, gradedAt, tipoff, featureCutoff: cutoff };
}

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
  const econSource = String(evidence.economicsSource || "");
  const pitOk = evidence.economicsProvenance?.ok === true;
  const econIsProspective = econSource === "nba_wager_decisions.prospective_pit" && pitOk;

  const criteria = [
    criterion(
      "graded_games",
      "Distinct graded games",
      graded >= rules.minimumGradedGames,
      graded,
      rules.minimumGradedGames,
      "COUNT(DISTINCT game_id); multi-model rows on one game count once"
    ),
    criterion("margin_improvement", "Margin RMSE improvement vs v1", marginImp != null && marginImp >= rules.marginImprovementMin, marginImp, rules.marginImprovementMin),
    criterion("total_improvement", "Total RMSE improvement vs v1", totalImp != null && totalImp >= rules.totalImprovementMin, totalImp, rules.totalImprovementMin),
    criterion("winner_accuracy", "Winner accuracy floor vs v1", winnerDelta != null && winnerDelta >= rules.winnerAccuracyFloorVsV1, winnerDelta, rules.winnerAccuracyFloorVsV1),
    criterion("brier", "Brier non-inferiority vs v1", brierDelta != null && brierDelta <= rules.brierNonInferiority, brierDelta, `<=${rules.brierNonInferiority}`),
    criterion("log_loss", "Log-loss non-inferiority vs v1", logLossDelta != null && logLossDelta <= rules.logLossNonInferiority, logLossDelta, `<=${rules.logLossNonInferiority}`),
    criterion("ece", "Calibration ECE max", ece != null && ece <= rules.eceMax, ece, `<=${rules.eceMax}`),
    criterion(
      "econ_pit_provenance",
      "Prospective PIT provenance verified",
      econIsProspective,
      pitOk ? evidence.economicsProvenance?.pitVerifiedN ?? 0 : 0,
      "feature_cutoff<=decision<=tipoff<=grade",
      pitOk ? null : (evidence.economicsProvenance?.reason || "UNVERIFIED_PIT_PROVENANCE")
    ),
    criterion(
      "clv_n",
      "Prospective CLV evaluated bets",
      econIsProspective && clvN >= rules.clv.minimumEvaluatedBets,
      clvN,
      rules.clv.minimumEvaluatedBets,
      econIsProspective ? null : "requires PIT-verified prospective wager-decision ledger"
    ),
    criterion(
      "clv_rate",
      "Prospective positive CLV rate",
      econIsProspective && clvRate != null && clvRate >= rules.clv.positiveClvRateMin,
      clvRate,
      rules.clv.positiveClvRateMin
    ),
    criterion(
      "clv_mean",
      "Prospective mean probability CLV",
      econIsProspective && clvMean != null && clvMean >= rules.clv.meanProbabilityClvMin,
      clvMean,
      rules.clv.meanProbabilityClvMin
    ),
    criterion(
      "settled_n",
      "Prospective settled bets",
      econIsProspective && settled >= rules.economics.minimumSettledBets,
      settled,
      rules.economics.minimumSettledBets
    ),
    criterion(
      "roi",
      "Prospective ROI positive",
      econIsProspective && (!rules.economics.roiMustBePositive || (roi != null && roi > 0)),
      roi,
      ">0"
    ),
    criterion(
      "units",
      "Prospective units positive",
      econIsProspective && (!rules.economics.unitsMustBePositive || (units != null && units > 0)),
      units,
      ">0"
    ),
    criterion(
      "drawdown",
      "Prospective max drawdown units",
      econIsProspective && drawdown != null && drawdown <= rules.economics.maxDrawdownUnitsMax,
      drawdown,
      `<=${rules.economics.maxDrawdownUnitsMax}`
    ),
    criterion("injury_n", "Injury subgroup distinct games", injuryN >= rules.subgroups.injuryMinimumN, injuryN, rules.subgroups.injuryMinimumN),
    criterion("schedule_n", "Schedule-stress subgroup distinct games", scheduleN >= rules.subgroups.scheduleStressMinimumN, scheduleN, rules.subgroups.scheduleStressMinimumN),
    // Missing regression is unverified failure — never pass on null/zero-fill.
    criterion(
      "injury_regression",
      "Injury catastrophic regression (measured)",
      injuryReg != null && injuryReg <= rules.subgroups.catastrophicRegressionTolerance,
      injuryReg,
      `<=${rules.subgroups.catastrophicRegressionTolerance}`,
      injuryReg == null ? "UNVERIFIED_MISSING_MEASUREMENT" : null
    ),
    criterion(
      "schedule_regression",
      "Schedule catastrophic regression (measured)",
      scheduleReg != null && scheduleReg <= rules.subgroups.catastrophicRegressionTolerance,
      scheduleReg,
      `<=${rules.subgroups.catastrophicRegressionTolerance}`,
      scheduleReg == null ? "UNVERIFIED_MISSING_MEASUREMENT" : null
    ),
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
    note: "Research board may publish projections, injuries, lineups, and research props while this gate is frozen. Wager authority requires every criterion with independent prospective evidence plus operator approval. D1 can_authorize alone is not a launch procedure.",
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

/** Collect evidence from D1. Missing measurements stay null/zero — never invented. */
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
    economicsSource: null,
    economicsProvenance: { ok: false, reason: "UNVERIFIED_PIT_PROVENANCE", pitVerifiedN: 0 },
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
    researchContext: null,
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

  // Distinct games only — three model rows on one game count as one.
  const gradedGames = await tryCount(
    "nba_prospective_game_shadow.graded_distinct_games",
    `SELECT COUNT(DISTINCT game_id) AS n FROM nba_prospective_game_shadow
     WHERE graded_at IS NOT NULL AND model_id LIKE 'NBA-%'`
  );

  let clvEvaluatedBets = 0;
  let positiveClvRate = null;
  let meanProbabilityClv = null;
  let settledBets = 0;
  let roiPct = null;
  let roiUnits = null;
  let maxDrawdownUnits = null;
  let economicsSource = null;
  let economicsProvenance = { ok: false, reason: "UNVERIFIED_PIT_PROVENANCE", pitVerifiedN: 0 };

  // Prospective economics: PIT-verified wager decisions only
  // (feature_cutoff ≤ decision ≤ tipoff ≤ grade via projection join).
  // Research validation runs / deep holdouts are never substituted here.
  try {
    const pitAudit = await db.prepare(
      `SELECT
         SUM(CASE WHEN p.id IS NOT NULL
                   AND d.decision_timestamp IS NOT NULL
                   AND p.tipoff_timestamp IS NOT NULL
                   AND p.feature_cutoff_timestamp IS NOT NULL
                   AND datetime(p.feature_cutoff_timestamp) <= datetime(d.decision_timestamp)
                   AND datetime(d.decision_timestamp) <= datetime(p.tipoff_timestamp)
                   AND datetime(d.decision_timestamp) <= datetime(d.graded_at)
              THEN 1 ELSE 0 END) AS pit_ok,
         SUM(CASE WHEN p.id IS NULL THEN 1 ELSE 0 END) AS missing_projection,
         SUM(CASE WHEN p.id IS NOT NULL AND (p.tipoff_timestamp IS NULL OR p.feature_cutoff_timestamp IS NULL) THEN 1 ELSE 0 END) AS missing_tipoff_or_cutoff,
         SUM(CASE WHEN p.id IS NOT NULL AND p.tipoff_timestamp IS NOT NULL AND datetime(d.decision_timestamp) > datetime(p.tipoff_timestamp) THEN 1 ELSE 0 END) AS decision_after_tipoff,
         SUM(CASE WHEN p.id IS NOT NULL AND p.feature_cutoff_timestamp IS NOT NULL AND datetime(p.feature_cutoff_timestamp) > datetime(d.decision_timestamp) THEN 1 ELSE 0 END) AS cutoff_after_decision,
         COUNT(*) AS graded_with_decision_ts
       FROM nba_wager_decisions d
       LEFT JOIN nba_game_projections p ON p.id = d.projection_id
       WHERE d.graded_at IS NOT NULL AND d.decision_timestamp IS NOT NULL`
    ).first();
    const pitVerifiedN = finite(pitAudit?.pit_ok) ?? 0;
    economicsProvenance = {
      ok: pitVerifiedN > 0,
      reason: pitVerifiedN > 0 ? null : "UNVERIFIED_PIT_PROVENANCE",
      pitVerifiedN,
      gradedWithDecisionTs: finite(pitAudit?.graded_with_decision_ts) ?? 0,
      rejectedMissingProjection: finite(pitAudit?.missing_projection) ?? 0,
      rejectedMissingTipoffOrCutoff: finite(pitAudit?.missing_tipoff_or_cutoff) ?? 0,
      rejectedDecisionAfterTipoff: finite(pitAudit?.decision_after_tipoff) ?? 0,
      rejectedCutoffAfterDecision: finite(pitAudit?.cutoff_after_decision) ?? 0,
      rule: "feature_cutoff<=decision<=tipoff AND decision<=graded_at",
    };
    sources.push("nba_wager_decisions.pit_provenance_audit");
  } catch {
    economicsProvenance = { ok: false, reason: "UNVERIFIED_PIT_PROVENANCE", pitVerifiedN: 0 };
  }

  try {
    const clv = await db.prepare(
      `SELECT COUNT(*) AS n,
              AVG(CASE WHEN d.clv_probability > 0 THEN 1.0 ELSE 0.0 END) AS pos_rate,
              AVG(d.clv_probability) AS mean_clv
       ${NBA_PROSPECTIVE_PIT_JOIN}
         AND d.clv_probability IS NOT NULL`
    ).first();
    clvEvaluatedBets = finite(clv?.n) ?? 0;
    positiveClvRate = finite(clv?.pos_rate);
    meanProbabilityClv = finite(clv?.mean_clv);
    if (clvEvaluatedBets > 0 && economicsProvenance.ok) {
      economicsSource = "nba_wager_decisions.prospective_pit";
      sources.push("nba_wager_decisions.clv.prospective_pit");
    }
  } catch { /* table may not have rows/columns yet */ }

  try {
    const eco = await db.prepare(
      `SELECT COUNT(*) AS n, SUM(d.profit_units) AS units,
              CASE WHEN SUM(ABS(COALESCE(d.stake_units,0))) > 0
                   THEN SUM(d.profit_units) / SUM(ABS(d.stake_units))
                   ELSE NULL END AS roi
       ${NBA_PROSPECTIVE_PIT_JOIN}
         AND d.profit_units IS NOT NULL`
    ).first();
    settledBets = finite(eco?.n) ?? 0;
    roiUnits = finite(eco?.units);
    roiPct = finite(eco?.roi) == null ? null : finite(eco.roi) * 100;
    if (settledBets > 0 && economicsProvenance.ok) {
      economicsSource = "nba_wager_decisions.prospective_pit";
      sources.push("nba_wager_decisions.economics.prospective_pit");
    }
  } catch { /* optional */ }

  // Running max drawdown from PIT-verified settled path only.
  try {
    const dd = await db.prepare(
      `SELECT MAX(running_dd) AS dd FROM (
         SELECT ABS(MIN(0,
           SUM(d.profit_units) OVER (ORDER BY d.graded_at, d.id ROWS UNBOUNDED PRECEDING)
         )) AS running_dd
         ${NBA_PROSPECTIVE_PIT_JOIN}
           AND d.profit_units IS NOT NULL
       )`
    ).first();
    maxDrawdownUnits = finite(dd?.dd);
  } catch {
    // SQLite window support varies — leave null (unverified) rather than invent.
    maxDrawdownUnits = null;
  }

  // Informational only — never fills gate economics/CLV criteria.
  let researchContext = null;
  try {
    const val = await db.prepare(
      `SELECT bet_n, units, roi_pct, max_drawdown_units, positive_clv_rate, graded_n, status, created_at
       FROM nba_decision_validation_runs
       ORDER BY created_at DESC LIMIT 1`
    ).first();
    if (val) {
      researchContext = {
        kind: "nba_decision_validation_runs",
        note: "Research/simulated validation context — not prospective economic evidence for gate criteria",
        betN: finite(val.bet_n),
        units: finite(val.units),
        roiPct: finite(val.roi_pct),
        maxDrawdownUnits: finite(val.max_drawdown_units),
        positiveClvRate: finite(val.positive_clv_rate),
        gradedN: finite(val.graded_n),
        status: val.status || null,
        createdAt: val.created_at || null,
      };
      sources.push("nba_decision_validation_runs.research_context_only");
    }
  } catch { /* optional */ }

  const injurySubgroupN = await tryCount(
    "shadow.injury.distinct_games",
    `SELECT COUNT(DISTINCT game_id) AS n FROM nba_prospective_game_shadow
     WHERE graded_at IS NOT NULL AND injury_buckets_json IS NOT NULL AND injury_buckets_json != '{}' AND injury_buckets_json != 'null'`
  );
  const scheduleStressSubgroupN = await tryCount(
    "shadow.schedule.distinct_games",
    `SELECT COUNT(DISTINCT game_id) AS n FROM nba_prospective_game_shadow
     WHERE graded_at IS NOT NULL AND schedule_buckets_json IS NOT NULL AND schedule_buckets_json != '{}' AND schedule_buckets_json != 'null'`
  );

  // Model-quality metrics: only accept when an explicit prospective evidence payload
  // is present. Historical deep holdout rows stay in researchContext, not criteria.
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
              details_json, validation_type, created_at
       FROM nba_deep_validation_runs
       ORDER BY created_at DESC LIMIT 1`
    ).first();
    if (deep) {
      const details = (() => {
        try { return deep.details_json ? JSON.parse(deep.details_json) : null; } catch { return null; }
      })();
      const prospective = String(deep.validation_type || "").toUpperCase().includes("PROSPECTIVE")
        || details?.prospectiveEvidence === true
        || details?.evidenceClass === "PROSPECTIVE";
      const deepSummary = {
        kind: "nba_deep_validation_runs",
        validationType: deep.validation_type || null,
        prospective,
        marginImprovement: finite(deep.margin_improvement),
        totalImprovement: finite(deep.total_improvement),
        createdAt: deep.created_at || null,
      };
      researchContext = researchContext
        ? { ...researchContext, deep: deepSummary }
        : { kind: "research_context", deep: deepSummary, note: "Historical/deep holdout is not automatic gate evidence" };
      sources.push(prospective ? "nba_deep_validation_runs.prospective" : "nba_deep_validation_runs.research_context_only");
      if (prospective) {
        marginImprovement = finite(deep.margin_improvement);
        totalImprovement = finite(deep.total_improvement);
        const chal = finite(deep.challenger_winner_accuracy);
        const inc = finite(deep.incumbent_winner_accuracy);
        if (chal != null && inc != null) winnerAccuracyDeltaVsV1 = chal - inc;
        brierDeltaVsV1 = finite(details?.brierDeltaVsV1 ?? details?.brier_delta);
        logLossDeltaVsV1 = finite(details?.logLossDeltaVsV1 ?? details?.log_loss_delta);
        ece = finite(details?.ece ?? details?.calibrationEce);
      }
    }
  } catch { /* optional */ }

  try {
    const cal = await db.prepare(
      `SELECT bins_json, created_at FROM nba_confidence_calibration
       ORDER BY created_at DESC LIMIT 1`
    ).first();
    if (cal) {
      const parsed = (() => {
        try { return cal.bins_json ? JSON.parse(cal.bins_json) : null; } catch { return null; }
      })();
      const prospective = parsed?.prospectiveEvidence === true || parsed?.evidenceClass === "PROSPECTIVE";
      if (prospective && ece == null) ece = finite(parsed?.ece ?? parsed?.ECE);
      sources.push(prospective ? "nba_confidence_calibration.prospective" : "nba_confidence_calibration.research_context_only");
    }
  } catch { /* optional */ }

  // Subgroup regression: leave null until a measured value exists.
  // Do NOT zero-fill — evaluate treats null as UNVERIFIED failure.
  let injuryCatastrophicRegression = null;
  let scheduleCatastrophicRegression = null;
  try {
    const sub = await db.prepare(
      `SELECT injury_regression, schedule_regression, details_json
       FROM nba_prospective_subgroup_metrics
       WHERE gate_version=? ORDER BY created_at DESC LIMIT 1`
    ).bind(NBA_PROSPECTIVE_GATE_VERSION).first();
    if (sub) {
      injuryCatastrophicRegression = finite(sub.injury_regression);
      scheduleCatastrophicRegression = finite(sub.schedule_regression);
      if (injuryCatastrophicRegression == null || scheduleCatastrophicRegression == null) {
        try {
          const d = sub.details_json ? JSON.parse(sub.details_json) : null;
          if (injuryCatastrophicRegression == null) {
            injuryCatastrophicRegression = finite(d?.injuryCatastrophicRegression);
          }
          if (scheduleCatastrophicRegression == null) {
            scheduleCatastrophicRegression = finite(d?.scheduleCatastrophicRegression);
          }
        } catch { /* ignore */ }
      }
      sources.push("nba_prospective_subgroup_metrics");
    }
  } catch { /* table optional — metrics remain UNVERIFIED */ }

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
    economicsSource,
    economicsProvenance,
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
    researchContext,
    operatorApproved,
    sources,
  };
}

export async function resolveNbaProspectiveGate(db) {
  const row = await loadNbaProspectiveGateRow(db);
  const rules = parseRules(row?.rules_json);
  const evidence = await collectNbaGateEvidence(db);
  const evaluation = evaluateNbaProspectiveGate(evidence, rules);
  // Fail-closed: D1 can_authorize=1 is necessary but never sufficient alone.
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
    canAuthorize: authorized,
    canQualify: authorized,
    criteriaReady,
    awaitingOperator,
    d1Status: row?.status || null,
    d1CanAuthorize: d1Allows,
    frozenAt: row?.frozen_at || null,
    evidence: {
      gradedGames: evidence.gradedGames,
      gradedGamesMetric: "COUNT(DISTINCT game_id)",
      clvEvaluatedBets: evidence.clvEvaluatedBets,
      positiveClvRate: evidence.positiveClvRate,
      meanProbabilityClv: evidence.meanProbabilityClv,
      settledBets: evidence.settledBets,
      roiPct: evidence.roiPct,
      roiUnits: evidence.roiUnits,
      maxDrawdownUnits: evidence.maxDrawdownUnits,
      economicsSource: evidence.economicsSource,
      economicsProvenance: evidence.economicsProvenance,
      marginImprovement: evidence.marginImprovement,
      totalImprovement: evidence.totalImprovement,
      winnerAccuracyDeltaVsV1: evidence.winnerAccuracyDeltaVsV1,
      brierDeltaVsV1: evidence.brierDeltaVsV1,
      logLossDeltaVsV1: evidence.logLossDeltaVsV1,
      ece: evidence.ece,
      injurySubgroupN: evidence.injurySubgroupN,
      scheduleStressSubgroupN: evidence.scheduleStressSubgroupN,
      injuryCatastrophicRegression: evidence.injuryCatastrophicRegression,
      scheduleCatastrophicRegression: evidence.scheduleCatastrophicRegression,
      researchContext: evidence.researchContext,
      sources: evidence.sources,
    },
    boardPolicy: authorized ? "WAGER_AUTHORITY_ENABLED" : "RESEARCH_DISPLAY_ONLY_NO_WAGER_AUTHORITY",
  };
}
