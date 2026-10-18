/**
 * Documented prior-decay for CFB-FBIS-v2.
 *
 * Production uses shrinkageWeight(n, k=6) = n/(n+k) inside blendPriorCurrent.
 * By Week 7 (n≈6–7 with week-bounded CORE coverage), current-season weight is
 * ≥50%. This module does not invent new weights to fit a single slate — it
 * exposes the production formula for audits, replays, and CI gates.
 *
 * Historical evaluations that compare alternate k values must write results as
 * research-only and must not mutate production coefficients.
 */

import { blendPriorCurrent, shrinkageWeight } from "./cfbFeatureStore.js";

export const CFB_PRIOR_DECAY_DEFAULT_K = 6;
export const CFB_PRIOR_DECAY_CANDIDATE_K = Object.freeze([3, 4, 6, 8, 10, 12]);

/** Current-season weight for a given observation count. */
export function currentSeasonWeight(gamesPlayed, k = CFB_PRIOR_DECAY_DEFAULT_K) {
  return shrinkageWeight(gamesPlayed, k);
}

/** Prior weight = 1 − current weight. */
export function priorSeasonWeight(gamesPlayed, k = CFB_PRIOR_DECAY_DEFAULT_K) {
  return Math.max(0, 1 - shrinkageWeight(gamesPlayed, k));
}

/**
 * Week-7 gate: with at least `minGames` observed (default 6), current evidence
 * must dominate the blend (weight ≥ 0.5 under default k=6).
 */
export function currentSeasonDominates({
  gamesPlayed,
  k = CFB_PRIOR_DECAY_DEFAULT_K,
  minGames = 6,
  minCurrentWeight = 0.5,
} = {}) {
  const n = Math.max(0, Number(gamesPlayed) || 0);
  if (n < minGames) {
    return {
      ok: false,
      reason: "insufficient-games",
      gamesPlayed: n,
      currentWeight: currentSeasonWeight(n, k),
      priorWeight: priorSeasonWeight(n, k),
    };
  }
  const w = currentSeasonWeight(n, k);
  return {
    ok: w >= minCurrentWeight,
    reason: w >= minCurrentWeight ? null : "prior-still-dominant",
    gamesPlayed: n,
    currentWeight: w,
    priorWeight: 1 - w,
    k,
    minCurrentWeight,
  };
}

export function blendWithAudit(prior, current, gamesPlayed, k = CFB_PRIOR_DECAY_DEFAULT_K) {
  const blend = blendPriorCurrent(prior, current, gamesPlayed, k);
  return {
    ...blend,
    prior: prior == null || prior === "" ? null : Number(prior),
    current: current == null || current === "" ? null : Number(current),
    gamesPlayed: Math.max(0, Number(gamesPlayed) || 0),
    priorWeight: 1 - blend.weight,
    currentWeight: blend.weight,
  };
}

/**
 * Evaluate candidate k values on a list of {prior, current, gamesPlayed, actual}
 * rows using absolute error of the blended rating vs actual (research-only).
 * Does not mutate production k.
 */
export function evaluatePriorDecayCandidates(rows = [], candidates = CFB_PRIOR_DECAY_CANDIDATE_K) {
  const out = [];
  for (const k of candidates) {
    let n = 0;
    let mae = 0;
    for (const row of rows) {
      const actual = Number(row.actual);
      if (!Number.isFinite(actual)) continue;
      const { value } = blendPriorCurrent(row.prior, row.current, row.gamesPlayed, k);
      if (!Number.isFinite(value)) continue;
      mae += Math.abs(value - actual);
      n += 1;
    }
    out.push({
      k,
      n,
      mae: n ? mae / n : null,
      productionDefault: k === CFB_PRIOR_DECAY_DEFAULT_K,
      researchOnly: true,
    });
  }
  return out.sort((a, b) => (a.mae ?? Infinity) - (b.mae ?? Infinity));
}
