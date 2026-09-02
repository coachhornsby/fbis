/**
 * SYS source-coverage counts. Distinct games, never padded with zero for missing sources.
 */

function distinct(rows, keyFn) {
  const map = new Map();
  for (const r of rows || []) {
    const k = keyFn(r);
    if (!k) continue;
    if (!map.has(k)) map.set(k, r);
  }
  return [...map.values()];
}

function gameKey(r) {
  return `${r.sport || ""}:${r.date}:${r.id || r.gameId || r.game_id}`;
}

export function sourceCoverage(rows, { scheduled = null } = {}) {
  const games = distinct(rows, gameKey);
  const n = scheduled != null ? scheduled : games.length;
  const having = (pred) => games.filter(pred);
  const palMatched = having((r) => r.palHome != null || r.palAway != null || r.palAsOf);
  const projected = having((r) => r.projHome != null && r.projAway != null);
  const pinMl = having((r) => r.pinHomeMl != null && r.pinAwayMl != null);
  const pinSpread = having((r) => r.pinSpread != null);
  const pinTotal = having((r) => r.pinTotal != null);
  const graded = having((r) => r.actualHome != null && r.actualAway != null);
  return {
    scheduled: n,
    games: games.length,
    projected: projected.length,
    pinMl: pinMl.length,
    pinSpread: pinSpread.length,
    pinTotal: pinTotal.length,
    palMatched: palMatched.length,
    palUnmatched: Math.max(0, games.length - palMatched.length),
    palProjected: palMatched.length,
    palGraded: palMatched.filter((r) => r.actualHome != null && r.actualAway != null).length,
    finalsGraded: graded.length,
    missingPinTotal: projected.length - pinTotal.filter((r) => r.projHome != null).length,
    missingPinSpread: projected.length - pinSpread.filter((r) => r.projHome != null).length,
  };
}

export function reconcilePalCounts({
  summaryMatched = null,
  summaryUnmatched = null,
  perGameMatched = 0,
  perGameUnmatched = 0,
} = {}) {
  if (summaryMatched == null && summaryUnmatched == null) {
    return { consistent: true, message: null, matched: perGameMatched, unmatched: perGameUnmatched };
  }
  const consistent =
    Number(summaryMatched) === Number(perGameMatched) && Number(summaryUnmatched) === Number(perGameUnmatched);
  return {
    consistent,
    matched: perGameMatched,
    unmatched: perGameUnmatched,
    summaryMatched,
    summaryUnmatched,
    message: consistent
      ? null
      : `Pal summary matched=${summaryMatched} unmatched=${summaryUnmatched} disagrees with per-game matched=${perGameMatched} unmatched=${perGameUnmatched}. Neither count is replaced with zero.`,
  };
}

export function palHealth(rows, meta = {}) {
  const games = distinct(rows, gameKey);
  const projected = games.filter((r) => r.palHome != null && r.palAway != null);
  const graded = projected.filter((r) => r.actualHome != null && r.actualAway != null);
  const n = games.length;
  return {
    matchedN: projected.length,
    unmatchedN: Math.max(0, n - projected.length),
    projectedN: projected.length,
    gradedN: graded.length,
    lastSuccess: meta.lastSuccess || meta.asOf || null,
    error: meta.error || null,
    enabled: meta.enabled !== false,
    requestId: meta.requestId || null,
    asOf: meta.asOf || null,
    unavailable: projected.length === 0,
    message:
      projected.length === 0
        ? "N=0 — unavailable"
        : graded.length === 0
          ? `Pal projection N=${projected.length}; Pal graded N=0; accuracy unavailable`
          : null,
  };
}
