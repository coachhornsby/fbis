/**
 * CFB slate diagnostics: projection states, duplicate-score warning, OOS metrics.
 * Do not promote model changes from one Week 0 slate.
 */

import { mae, rmse, bias } from "./metrics.js";
import { brierScore, logLoss } from "./pricing.js";

export const CFB_DUPLICATE_WARN = {
  minGames: 4,
  modeShare: 0.35,
  minModeCount: 4,
};

export function scorePairKey(home, away) {
  if (home == null || away == null) return null;
  return `${Number(away).toFixed(1)}-${Number(home).toFixed(1)}`;
}

export function cfbStateCounts(games) {
  const counts = {
    COMPLETE: 0,
    PARTIAL: 0,
    PRIOR_ONLY: 0,
    LEAGUE_AVERAGE_ONLY: 0,
    UNAVAILABLE: 0,
  };
  let qualified = 0;
  let blocked = 0;
  for (const g of games || []) {
    const state = g.cfb?.projectionState || g.projectionState || (g.projHome == null && g.projAway == null ? "UNAVAILABLE" : null);
    if (state && counts[state] != null) counts[state] += 1;
    else if (!state) counts.UNAVAILABLE += 1;
    if (g.rec?.qualified || g.rec) qualified += 1;
    if (g.cfb?.bettingAllowed === false || g.qualificationBlocked) blocked += 1;
  }
  return { ...counts, qualified, blocked, n: (games || []).length };
}

export function duplicateProjectionDiagnostic(games) {
  const pairs = new Map();
  let scored = 0;
  for (const g of games || []) {
    const key = scorePairKey(g.cfb?.home ?? g.projHomeScore ?? g.projHome, g.cfb?.away ?? g.projAwayScore ?? g.projAway)
      || scorePairKey(g.model?.projHome, g.model?.projAway);
    if (!key) continue;
    scored += 1;
    pairs.set(key, (pairs.get(key) || 0) + 1);
  }
  const unique = pairs.size;
  let modeKey = null;
  let modeCount = 0;
  for (const [k, n] of pairs) {
    if (n > modeCount) {
      modeCount = n;
      modeKey = k;
    }
  }
  const share = scored ? modeCount / scored : 0;
  const warn =
    scored >= CFB_DUPLICATE_WARN.minGames &&
    modeCount >= CFB_DUPLICATE_WARN.minModeCount &&
    share >= CFB_DUPLICATE_WARN.modeShare;
  return {
    n: scored,
    uniqueScorePairs: unique,
    modeKey,
    modeCount,
    modeShare: share,
    warn,
    message: warn
      ? `CFB MODEL WARNING  ${modeCount} of ${scored} games share identical projections (${modeKey}). Team-specific inputs may be unavailable.`
      : null,
  };
}

export function cfbSlateDiagnostics(games) {
  const states = cfbStateCounts(games);
  const dup = duplicateProjectionDiagnostic(games);
  return {
    games: states.n,
    uniqueProjectedScorePairs: dup.uniqueScorePairs,
    leagueAverageOnly: states.LEAGUE_AVERAGE_ONLY,
    priorOnly: states.PRIOR_ONLY,
    partial: states.PARTIAL,
    complete: states.COMPLETE,
    unavailable: states.UNAVAILABLE,
    qualified: states.qualified,
    qualificationBlocked: states.blocked,
    duplicate: dup,
  };
}

export function cfbOosMetrics(rows) {
  const graded = (rows || []).filter(
    (r) => r.actualHome != null && r.actualAway != null && r.projHome != null && r.projAway != null
  );
  const n = graded.length;
  const homeErr = graded.map((r) => r.actualHome - r.projHome);
  const awayErr = graded.map((r) => r.actualAway - r.projAway);
  const totalErr = graded.map((r) => r.actualHome + r.actualAway - (r.projHome + r.projAway));
  const marginErr = graded.map((r) => r.actualHome - r.actualAway - (r.projHome - r.projAway));
  const winnerHit = n
    ? graded.filter((r) => (r.projHome >= r.projAway) === (r.actualHome >= r.actualAway)).length / n
    : null;
  const briers = graded.map((r) => (r.pHomeFinal != null ? brierScore(r.pHomeFinal, r.actualHome > r.actualAway) : null)).filter((x) => x != null);
  const logs = graded.map((r) => (r.pHomeFinal != null ? logLoss(r.pHomeFinal, r.actualHome > r.actualAway) : null)).filter((x) => x != null);
  return {
    n,
    scoreMae: n ? mae([...homeErr, ...awayErr]) : null,
    totalMae: n ? mae(totalErr) : null,
    marginMae: n ? mae(marginErr) : null,
    rmse: n ? rmse([...homeErr, ...awayErr]) : null,
    signedBias: n ? bias([...homeErr, ...awayErr]) : null,
    winnerHitRate: winnerHit,
    brier: briers.length ? briers.reduce((s, x) => s + x, 0) / briers.length : null,
    logLoss: logs.length ? logs.reduce((s, x) => s + x, 0) / logs.length : null,
    note: "Do not promote CFB model changes from one Week 0 slate.",
  };
}
