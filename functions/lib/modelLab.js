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
  return {
    home,
    away,
    margin: home - away,
    total: home + away,
  };
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
  return rows
    .map((row) => predictionErrors(row)?.[key])
    .filter((v) => Number.isFinite(v));
}

function summarizeVector(errs, sport, kind) {
  return {
    n: errs.length,
    mae: mae(errs),
    rmse: rmse(errs),
    bias: bias(errs),
    within: withinBands(errs, sport, kind),
  };
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
    team: {
      home: summarizeVector(home, resolvedSport, "team"),
      away: summarizeVector(away, resolvedSport, "team"),
    },
    margin: summarizeVector(margin, resolvedSport, "margin"),
    total: summarizeVector(total, resolvedSport, "total"),
  };
}

function gameKey(row) {
  return String(row?.game_id ?? row?.gameId ?? "");
}

export function pairedModelComparison(championRows = [], challengerRows = [], { sport = null } = {}) {
  const championByGame = new Map(
    championRows.filter(isGradedPrediction).map((row) => [gameKey(row), row]).filter(([key]) => key)
  );
  const pairedChampion = [];
  const pairedChallenger = [];
  for (const row of challengerRows.filter(isGradedPrediction)) {
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
  return {
    n: pairedChampion.length,
    champion,
    challenger,
    delta: {
      marginMae: delta(champion.margin.mae, challenger.margin.mae),
      totalMae: delta(champion.total.mae, challenger.total.mae),
      marginBiasAbs: delta(Math.abs(champion.margin.bias ?? NaN), Math.abs(challenger.margin.bias ?? NaN)),
      totalBiasAbs: delta(Math.abs(champion.total.bias ?? NaN), Math.abs(challenger.total.bias ?? NaN)),
    },
    interpretation: "Negative MAE delta means the challenger improved on the champion over identical graded games.",
  };
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
        ...pairedModelComparison(
          championRows,
          graded.filter((row) => String(row.model_id) === entry.modelId),
          { sport: normalizedSport }
        ),
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
