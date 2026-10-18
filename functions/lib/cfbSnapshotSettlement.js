/**
 * Repair settlement gaps: when verified finals exist on `predictions` (or an
 * external ESPN-reconciled plan) but CLOSE `prediction_snapshots` still have
 * null actuals, promote actuals without touching proj_* columns.
 *
 * Never invents scores. Never overwrites non-null snapshot actuals unless
 * forceCorrect is set (mirrors gradeSnapshotsForGame).
 */

import { gradeSnapshotsForGame } from "./store.js";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Find CLOSE snapshots missing actuals where predictions already have them.
 */
export async function findSnapshotPredictionGaps(env, { sport = "cfb", date } = {}) {
  if (!env?.DB?.prepare || !date) return { ok: false, reason: "unbound-or-missing-date", gaps: [] };
  const rows = await env.DB.prepare(`
    SELECT c.game_id AS game_id, c.matchup AS matchup,
           c.actual_home AS close_home, c.actual_away AS close_away,
           p.actual_home AS pred_home, p.actual_away AS pred_away
    FROM prediction_snapshots c
    LEFT JOIN predictions p
      ON p.game_id = c.game_id AND p.sport = c.sport AND p.date = c.date
    WHERE c.sport = ? AND c.date = ? AND c.checkpoint = 'CLOSE'
      AND c.actual_home IS NULL
    ORDER BY c.game_id
  `).bind(sport, date).all();

  const gaps = [];
  for (const r of rows?.results || []) {
    const predHome = num(r.pred_home);
    const predAway = num(r.pred_away);
    gaps.push({
      gameId: String(r.game_id),
      matchup: r.matchup,
      predictionActualHome: predHome,
      predictionActualAway: predAway,
      canPromoteFromPredictions: predHome != null && predAway != null,
    });
  }
  return { ok: true, gaps, promotable: gaps.filter((g) => g.canPromoteFromPredictions) };
}

/**
 * Promote verified prediction finals onto all prediction_snapshots for those games.
 * Caps batch size at 25 (same as /api/final-grade).
 */
export async function promotePredictionFinalsToSnapshots(env, {
  sport = "cfb",
  date,
  limit = 25,
  gradedAt = null,
} = {}) {
  const found = await findSnapshotPredictionGaps(env, { sport, date });
  if (!found.ok) return found;
  const batch = found.promotable.slice(0, Math.max(1, Math.min(25, limit)));
  let matched = 0;
  const failedGameIds = [];
  const applied = [];
  for (const g of batch) {
    const res = await gradeSnapshotsForGame(env, {
      gameId: g.gameId,
      actualHome: g.predictionActualHome,
      actualAway: g.predictionActualAway,
      gradedAt: gradedAt || new Date().toISOString(),
      forceCorrect: false,
    });
    if (res?.ok) {
      matched += 1;
      applied.push({
        gameId: g.gameId,
        matchup: g.matchup,
        actualAway: g.predictionActualAway,
        actualHome: g.predictionActualHome,
        source: "predictions",
      });
    } else {
      failedGameIds.push(g.gameId);
    }
  }
  return {
    ok: failedGameIds.length === 0,
    mode: "promote-predictions-to-snapshots",
    sport,
    date,
    promotable: found.promotable.length,
    accepted: batch.length,
    matched,
    failed: failedGameIds.length,
    failedGameIds,
    applied,
    remainingGaps: found.gaps.length - matched,
  };
}

/**
 * Apply an ESPN-reconciled grade plan (gameId + scores). Does not invent.
 */
export async function applyVerifiedGradePlan(env, grades = [], { gradedAt = null } = {}) {
  const batch = (grades || []).slice(0, 25);
  let matched = 0;
  const failedGameIds = [];
  const applied = [];
  for (const g of batch) {
    const gameId = String(g.gameId || g.game_id || "").trim();
    const actualHome = num(g.actualHome ?? g.home);
    const actualAway = num(g.actualAway ?? g.away);
    if (!gameId || actualHome == null || actualAway == null) {
      failedGameIds.push(gameId || "invalid");
      continue;
    }
    const res = await gradeSnapshotsForGame(env, {
      gameId,
      actualHome,
      actualAway,
      gradedAt: gradedAt || new Date().toISOString(),
      forceCorrect: false,
    });
    if (res?.ok) {
      matched += 1;
      applied.push({ gameId, actualAway, actualHome, source: g.source || "verified-plan" });
    } else failedGameIds.push(gameId);
  }
  return {
    ok: failedGameIds.length === 0,
    mode: "verified-grade-plan",
    accepted: batch.length,
    matched,
    failed: failedGameIds.length,
    failedGameIds,
    applied,
  };
}
