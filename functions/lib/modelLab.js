/**
 * Unified FBIS Model Laboratory.
 *
 * Pure evaluation helpers for frozen model_predictions. This module does not
 * promote models, mutate historical projections, or use current-game results
 * to alter a frozen prediction. It is intentionally sport-agnostic so CBB,
 * CFB, NFL and MLB can share the same research standard.
 */

import { mae, rmse, bias, withinBands } from "./metrics.js";
import { queryModelPredictions } from "./collegeStore.js";

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowActuals(row) {
  const home = finite(row?.actual_home ?? row?.actualHome);
  const away = finite(row?.actual_away ?? row?.actualAway);
  if (home == null || away == null) return null;
  return { home, away, margin: home - away, total: home + away };
}

function rowProjection(row) {
  const home = finite(row?.proj_home ?? row?.projHome);
  const away = finite(row?.proj_away ?? row?.projAway);
  const margin = finite(row?.proj_margin ?? row?.projMargin);
  const total = finite(row?.proj_total ?? row?.projTotal);
  return {
    home,
    away,
    margin: margin ?? (home != null && away != null ? home - away : null),
    total: total ?? (home != null && away != null ? home + away : null),
  };
}

function rowHomeProbability(row) {
  const p = finite(row?.p_home_win ?? row?.pHomeWin);
  return p != null && p > 0 && p < 1 ? p : null;
}

export function isGradedPrediction(row) {
  return Boolean(rowActuals(row));
}

export function predictionErrors(row) {
  const actual = rowActuals(row);
  if (!actual) return null;
  const proj = rowProjection(row);
  return {
    home: proj.home == null ? null : proj.home - actual.home,
    away: proj.away == null ? null : proj.away - actual.away,
    margin: proj.margin == null ? null : proj.margin - actual.margin,
    total: proj.total == null ? null : proj.total - actual.total,
  };
}

function metricVector(rows, key) {
  return rows.map((row) => predictionErrors(row)?.[key]).filter((v) => Number.isFinite(v));
}

function summarizeVector(errs, sport, kind) {
  return { n: errs.length, mae: mae(errs), rmse: rmse(errs), bias: bias(errs), within: withinBands(errs, sport, kind) };
}

function probabilitySummary(rows) {
  let n = 0;
  let brierSum = 0;
  let logLossSum = 0;
  for (const row of rows) {
    const actual = rowActuals(row);
    const p = rowHomeProbability(row);
    if (!actual || p == null || actual.home === actual.away) continue;
    const y = actual.home > actual.away ? 1 : 0;
    n += 1;
    brierSum += (p - y) ** 2;
    logLossSum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return {
    n,
    brier: n ? brierSum / n : null,
    logLoss: n ? logLossSum / n : null,
    coverage: rows.length ? n / rows.length : 0,
  };
}

export function predictionSeason(row) {
  if (row?.season != null && row.season !== "") return String(row.season);
  const frozen = row?.frozen_at ?? row?.frozenAt;
  const ms = Date.parse(frozen || "");
  return Number.isFinite(ms) ? String(new Date(ms).getUTCFullYear()) : null;
}

export function predictionSeasonCount(rows = []) {
  return new Set(rows.filter(isGradedPrediction).map(predictionSeason).filter(Boolean)).size;
}

export function evaluateModelRows(rows = [], { sport = null } = {}) {
  const graded = rows.filter(isGradedPrediction);
  const resolvedSport = String(sport || graded[0]?.sport || rows[0]?.sport || "").toLowerCase() || "mlb";
  const home = metricVector(graded, "home");
  const away = metricVector(graded, "away");
  const margin = metricVector(graded, "margin");
  const total = metricVector(graded, "total");
  return {
    sport: resolvedSport,
    n: graded.length,
    seasons: predictionSeasonCount(graded),
    team: {
      home: summarizeVector(home, resolvedSport, "team"),
      away: summarizeVector(away, resolvedSport, "team"),
    },
    margin: summarizeVector(margin, resolvedSport, "margin"),
    total: summarizeVector(total, resolvedSport, "total"),
    probability: probabilitySummary(graded),
  };
}

function gameKey(row) {
  return String(row?.game_id ?? row?.gameId ?? "");
}

export function pairedModelComparison(championRows = [], challengerRows = [], { sport = null } = {}) {
  const championGraded = championRows.filter(isGradedPrediction);
  const challengerGraded = challengerRows.filter(isGradedPrediction);
  const championByGame = new Map(championGraded.map((row) => [gameKey(row), row]).filter(([key]) => key));
  const pairedChampion = [];
  const pairedChallenger = [];
  for (const row of challengerGraded) {
    const key = gameKey(row);
    const champion = championByGame.get(key);
    if (!champion) continue;
    const cActual = rowActuals(champion);
    const xActual = rowActuals(row);
    if (!cActual || !xActual || cActual.home !== xActual.home || cActual.away !== xActual.away) continue;
    pairedChampion.push(champion);
    pairedChallenger.push(row);
  }
  const champion = evaluateModelRows(pairedChampion, { sport });
  const challenger = evaluateModelRows(pairedChallenger, { sport });
  const delta = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? b - a : null);
  const coverageDenominator = championGraded.length;
  return {
    n: pairedChampion.length,
    seasons: predictionSeasonCount(pairedChallenger),
    coverage: coverageDenominator ? pairedChampion.length / coverageDenominator : 0,
    champion,
    challenger,
    delta: {
      marginMae: delta(champion.margin.mae, challenger.margin.mae),
      totalMae: delta(champion.total.mae, challenger.total.mae),
      marginBiasAbs: delta(Math.abs(champion.margin.bias ?? NaN), Math.abs(challenger.margin.bias ?? NaN)),
      totalBiasAbs: delta(Math.abs(champion.total.bias ?? NaN), Math.abs(challenger.total.bias ?? NaN)),
      brier: delta(champion.probability.brier, challenger.probability.brier),
    },
    interpretation: "Negative MAE/Brier delta means the challenger improved on the reference over identical graded games.",
  };
}

export function promotionEvidence(referenceRows = [], challengerRows = [], { sport = null, leakageOk = false, artifactOk = false } = {}) {
  const paired = pairedModelComparison(referenceRows, challengerRows, { sport });
  const totalMaeDelta = paired.delta.totalMae;
  const brierDelta = paired.delta.brier;
  return {
    n: paired.n,
    seasons: paired.seasons,
    maeImprovement: Number.isFinite(totalMaeDelta) ? -totalMaeDelta : null,
    biasAbs: Number.isFinite(paired.challenger.total.bias) ? Math.abs(paired.challenger.total.bias) : null,
    brierDegradation: Number.isFinite(brierDelta) ? brierDelta : null,
    coverage: paired.coverage,
    leakageOk: Boolean(leakageOk),
    artifactOk: Boolean(artifactOk),
    paired,
  };
}


function learningFrozenAt(row) {
  const raw = row?.frozen_at ?? row?.frozenAt;
  const ms = Date.parse(raw || "");
  return Number.isFinite(ms) ? ms : null;
}

function learningMetric(summary, key) {
  if (key === "total.mae") return summary?.total?.mae ?? null;
  if (key === "margin.mae") return summary?.margin?.mae ?? null;
  if (key === "total.biasAbs") {
    const v = summary?.total?.bias;
    return Number.isFinite(v) ? Math.abs(v) : null;
  }
  if (key === "margin.biasAbs") {
    const v = summary?.margin?.bias;
    return Number.isFinite(v) ? Math.abs(v) : null;
  }
  if (key === "probability.brier") return summary?.probability?.brier ?? null;
  return null;
}

function favoriteBucket(row) {
  const margin = rowProjection(row).margin;
  if (!Number.isFinite(margin)) return null;
  const abs = Math.abs(margin);
  if (abs <= 3) return "favorite:tossup";
  if (abs <= 10) return "favorite:medium";
  return "favorite:large";
}

function learningSeverity(delta, warning, high) {
  if (!Number.isFinite(delta) || delta < warning) return null;
  return delta >= high ? "HIGH" : "WATCH";
}

/**
 * Detect repeatable degradation, not one-off misses.
 * Research-only: findings do not mutate or promote production models.
 */
export function buildLearningFindings(
  rows = [],
  {
    sport = null,
    modelId = null,
    recentN = 50,
    minWindowN = 20,
    minSliceN = 15,
  } = {}
) {
  const ordered = rows
    .filter(isGradedPrediction)
    .filter((row) => learningFrozenAt(row) != null)
    .slice()
    .sort((a, b) => learningFrozenAt(a) - learningFrozenAt(b));

  if (ordered.length < minWindowN * 2) return [];

  const resolvedSport = String(sport || ordered[0]?.sport || "").toLowerCase() || "unknown";
  const resolvedModel = String(modelId || ordered[0]?.model_id || ordered[0]?.modelId || "unknown");
  const requestedRecent = Math.max(minWindowN, Number(recentN) || 50);
  const recentSize = Math.min(requestedRecent, ordered.length - minWindowN);
  const baselineRows = ordered.slice(0, ordered.length - recentSize);
  const recentRows = ordered.slice(ordered.length - recentSize);
  if (baselineRows.length < minWindowN || recentRows.length < minWindowN) return [];

  const baseline = evaluateModelRows(baselineRows, { sport: resolvedSport });
  const recent = evaluateModelRows(recentRows, { sport: resolvedSport });
  const windowStart = recentRows[0]?.frozen_at ?? recentRows[0]?.frozenAt ?? null;
  const windowEnd = recentRows.at(-1)?.frozen_at ?? recentRows.at(-1)?.frozenAt ?? null;
  const findings = [];

  const driftSpecs = [
    { metric: "total.mae", warning: 0.5, high: 1.0, label: "total projection MAE" },
    { metric: "margin.mae", warning: 0.5, high: 1.0, label: "margin projection MAE" },
    { metric: "total.biasAbs", warning: 0.75, high: 1.5, label: "absolute total bias" },
    { metric: "margin.biasAbs", warning: 0.75, high: 1.5, label: "absolute margin bias" },
    { metric: "probability.brier", warning: 0.02, high: 0.05, label: "home-win Brier score" },
  ];

  for (const spec of driftSpecs) {
    if (
      spec.metric === "probability.brier" &&
      (Number(baseline?.probability?.n || 0) < minWindowN || Number(recent?.probability?.n || 0) < minWindowN)
    ) {
      continue;
    }
    const baseValue = learningMetric(baseline, spec.metric);
    const recentValue = learningMetric(recent, spec.metric);
    const delta =
      Number.isFinite(baseValue) && Number.isFinite(recentValue)
        ? recentValue - baseValue
        : null;
    const severity = learningSeverity(delta, spec.warning, spec.high);
    if (!severity) continue;
    findings.push({
      findingType: "drift",
      sliceKey: "recent-vs-prior",
      metric: spec.metric,
      baselineN: baseline.n,
      recentN: recent.n,
      baselineValue: baseValue,
      recentValue,
      delta,
      severity,
      windowStart,
      windowEnd,
      hypothesis: \`\${resolvedModel} \${spec.label} has degraded in the recent window; investigate changed data quality, feature behavior, roster/context inputs, or model calibration before changing production logic.\`,
      evidence: {
        sport: resolvedSport,
        modelId: resolvedModel,
        baselineWindow: {
          n: baselineRows.length,
          from: baselineRows[0]?.frozen_at ?? baselineRows[0]?.frozenAt ?? null,
          to: baselineRows.at(-1)?.frozen_at ?? baselineRows.at(-1)?.frozenAt ?? null,
        },
        recentWindow: { n: recentRows.length, from: windowStart, to: windowEnd },
      },
      status: "OPEN",
    });
  }

  const groups = new Map();
  for (const row of ordered) {
    const key = favoriteBucket(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const [sliceKey, sliceRows] of groups.entries()) {
    if (sliceRows.length < minSliceN) continue;
    const sliceSet = new Set(sliceRows);
    const rest = ordered.filter((row) => !sliceSet.has(row));
    if (rest.length < minWindowN) continue;
    const sliceSummary = evaluateModelRows(sliceRows, { sport: resolvedSport });
    const restSummary = evaluateModelRows(rest, { sport: resolvedSport });
    const sliceMae = sliceSummary.margin.mae;
    const restMae = restSummary.margin.mae;
    const delta =
      Number.isFinite(sliceMae) && Number.isFinite(restMae)
        ? sliceMae - restMae
        : null;
    const severity = learningSeverity(delta, 1.5, 3.0);
    if (!severity) continue;
    const label = sliceKey === "favorite:large"
      ? "large projected favorites"
      : sliceKey === "favorite:medium"
        ? "medium projected favorites"
        : "near-pick'em games";
    findings.push({
      findingType: "slice",
      sliceKey,
      metric: "margin.mae",
      baselineN: restSummary.n,
      recentN: sliceSummary.n,
      baselineValue: restMae,
      recentValue: sliceMae,
      delta,
      severity,
      windowStart: sliceRows[0]?.frozen_at ?? sliceRows[0]?.frozenAt ?? null,
      windowEnd: sliceRows.at(-1)?.frozen_at ?? sliceRows.at(-1)?.frozenAt ?? null,
      hypothesis: \`\${resolvedModel} is materially less accurate on \${label}; test whether the error is explained by data quality, favorite-strength compression, player availability, or matchup-feature misspecification.\`,
      evidence: {
        sport: resolvedSport,
        modelId: resolvedModel,
        slice: sliceKey,
        sliceN: sliceSummary.n,
        comparisonN: restSummary.n,
      },
      status: "OPEN",
    });
  }

  return findings;
}

export function modelLeaderboard(rows = [], { sport = null, includeMarketInformed = false } = {}) {
  const groups = new Map();
  for (const row of rows) {
    if (!includeMarketInformed && Number(row?.market_informed ?? row?.marketInformed ?? 0) === 1) continue;
    const id = String(row?.model_id ?? row?.modelId ?? "");
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return [...groups.entries()]
    .map(([modelId, modelRows]) => ({ modelId, ...evaluateModelRows(modelRows, { sport }) }))
    .sort((a, b) => {
      const aMae = a.total.mae ?? Number.POSITIVE_INFINITY;
      const bMae = b.total.mae ?? Number.POSITIVE_INFINITY;
      if (aMae !== bMae) return aMae - bMae;
      return (a.margin.mae ?? Number.POSITIVE_INFINITY) - (b.margin.mae ?? Number.POSITIVE_INFINITY);
    });
}

export async function buildModelLabReport(env, { sport, championModelId = null, limit = 5000, includeMarketInformed = false } = {}) {
  const normalizedSport = String(sport || "").toLowerCase();
  if (!normalizedSport) return { ok: false, error: "sport-required" };
  const rows = await queryModelPredictions(env, { sport: normalizedSport, limit: Math.min(Math.max(Number(limit) || 5000, 1), 10000) });
  const graded = rows.filter(isGradedPrediction);
  const leaderboard = modelLeaderboard(graded, { sport: normalizedSport, includeMarketInformed });
  let comparisons = [];
  if (championModelId) {
    const championRows = graded.filter((row) => String(row.model_id) === String(championModelId));
    comparisons = leaderboard
      .filter((entry) => entry.modelId !== championModelId)
      .map((entry) => ({
        modelId: entry.modelId,
        ...pairedModelComparison(championRows, graded.filter((row) => String(row.model_id) === entry.modelId), { sport: normalizedSport }),
      }));
  }
  return {
    ok: true,
    sport: normalizedSport,
    rows: rows.length,
    graded: graded.length,
    championModelId,
    leaderboard,
    comparisons,
    generatedAt: new Date().toISOString(),
    note: "Research output only. Model promotion remains explicit and requires predeclared validation criteria plus operator approval.",
  };
}
