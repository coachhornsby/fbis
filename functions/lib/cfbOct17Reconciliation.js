/**
 * October 17, 2026 diagnostic reconciliation — consistent eligible cohort.
 * Diagnostic only: do not use as promotion evidence.
 */

export const OCT17_RECON_VERSION = "cfb-oct17-reconciliation-v1";

/** Reported CLOSE snapshot universe. */
export const OCT17_CLOSE_SNAPSHOTS = 45;
/** Initially reported verified finals. */
export const OCT17_VERIFIED_FINALS_INITIAL = 40;
/** Initially reported still in-progress at first audit. */
export const OCT17_IN_PROGRESS_INITIAL = 5;

/**
 * Reconcile winner-accuracy denominator claims.
 * Original "57.1%" must be recomputed against an explicit eligible cohort —
 * never mix strict and diagnostic modes.
 */
export function reconcileWinnerAccuracyClaim({
  correctWinners,
  eligibleN,
  reportedPct = 57.1,
} = {}) {
  const n = Number(eligibleN) || 0;
  const hits = Number(correctWinners) || 0;
  const actualPct = n > 0 ? Math.round((hits / n) * 1000) / 10 : null;
  const impliedHits = n > 0 ? Math.round((reportedPct / 100) * n) : null;
  return {
    reportedPct,
    eligibleN: n,
    correctWinners: hits,
    actualPct,
    impliedHitsForReportedPct: impliedHits,
    consistent:
      actualPct != null && Math.abs(actualPct - reportedPct) < 0.2,
    note:
      "Winner accuracy is hits/eligible only. Do not include pushes, unscored, or mixed strict/diagnostic rows.",
  };
}

export function summarizeDiagnosticCohort(rows = []) {
  const scored = (rows || []).filter(
    (r) =>
      r.actualHome != null &&
      r.actualAway != null &&
      r.projHome != null &&
      r.projAway != null
  );
  let winnerHits = 0;
  let marginAbs = 0;
  let totalAbs = 0;
  let homeAbs = 0;
  let awayAbs = 0;
  let biasHome = 0;
  let favErr = 0;
  let dogErr = 0;
  let favN = 0;
  let dogN = 0;
  const significantMisses = [];

  for (const r of scored) {
    const ah = Number(r.actualHome);
    const aa = Number(r.actualAway);
    const ph = Number(r.projHome);
    const pa = Number(r.projAway);
    const actualMargin = ah - aa;
    const projMargin = ph - pa;
    const actualTotal = ah + aa;
    const projTotal = ph + pa;
    if ((ph > pa) === (ah > aa)) winnerHits += 1;
    marginAbs += Math.abs(projMargin - actualMargin);
    totalAbs += Math.abs(projTotal - actualTotal);
    homeAbs += Math.abs(ph - ah);
    awayAbs += Math.abs(pa - aa);
    biasHome += ph - ah;
    const favHome = ph >= pa;
    const favErrPts = favHome ? Math.abs(ph - ah) : Math.abs(pa - aa);
    const dogErrPts = favHome ? Math.abs(pa - aa) : Math.abs(ph - ah);
    favErr += favErrPts;
    dogErr += dogErrPts;
    favN += 1;
    dogN += 1;
    if (Math.abs(projMargin - actualMargin) >= 17) {
      significantMisses.push({
        gameId: r.gameId || r.matchup,
        matchup: r.matchup,
        projMargin,
        actualMargin,
        absMarginError: Math.abs(projMargin - actualMargin),
      });
    }
  }

  const n = scored.length;
  const avg = (s) => (n ? Math.round((s / n) * 10) / 10 : null);
  return {
    version: OCT17_RECON_VERSION,
    mode: "diagnostic",
    eligibleN: n,
    winnerHits,
    winnerAccuracyPct: n ? Math.round((winnerHits / n) * 1000) / 10 : null,
    marginMae: avg(marginAbs),
    totalMae: avg(totalAbs),
    homeScoreMae: avg(homeAbs),
    awayScoreMae: avg(awayAbs),
    homeScoreBias: avg(biasHome),
    favoriteScoreMae: favN ? Math.round((favErr / favN) * 10) / 10 : null,
    underdogScoreMae: dogN ? Math.round((dogErr / dogN) * 10) / 10 : null,
    significantMisses: significantMisses.sort((a, b) => b.absMarginError - a.absMarginError).slice(0, 15),
    promotionAuthorized: false,
    note: "Diagnostic cohort only — not a promotion gate. Do not tune on these outcomes.",
  };
}

export function compareModelVariants({ original = null, repaired = null, challengers = {} } = {}) {
  const pack = (label, summary) =>
    summary
      ? {
          label,
          eligibleN: summary.eligibleN,
          winnerAccuracyPct: summary.winnerAccuracyPct,
          marginMae: summary.marginMae,
          totalMae: summary.totalMae,
        }
      : null;
  return {
    version: OCT17_RECON_VERSION,
    original: pack("original-close", original),
    repaired: pack("repaired-champion", repaired),
    challengers: Object.fromEntries(
      Object.entries(challengers || {}).map(([k, v]) => [k, pack(k, v)])
    ),
    attributionNote:
      "Separate feature-repair effects from coefficient changes; Oct17 is diagnostic, not OOS promotion proof",
    promotionAuthorized: false,
  };
}

export function oct17UniverseStatus({
  closeSnapshots = OCT17_CLOSE_SNAPSHOTS,
  gradedFinals = null,
  inProgress = null,
} = {}) {
  const graded = gradedFinals != null ? Number(gradedFinals) : OCT17_VERIFIED_FINALS_INITIAL;
  const open =
    inProgress != null
      ? Number(inProgress)
      : Math.max(0, closeSnapshots - graded);
  return {
    closeSnapshots,
    gradedFinals: graded,
    inProgressOrUngraded: open,
    initialReport: {
      verifiedFinals: OCT17_VERIFIED_FINALS_INITIAL,
      inProgress: OCT17_IN_PROGRESS_INITIAL,
    },
    note: "Recompute metrics on a single eligible cohort; do not mix 40- and 45-game denominators.",
  };
}
