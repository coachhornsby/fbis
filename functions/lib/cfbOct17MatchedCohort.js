/**
 * Matched-cohort Oct 17 accuracy comparison.
 * Never mutates original CLOSE snapshots.
 * Distinguishes:
 *  - closeUniverse (all CLOSE rows)
 *  - gradedFinals (actual scores present)
 *  - rebuiltEligible (repaired projection ok + graded)
 *  - matchedComparable (original + rebuilt both graded — fair comparison)
 */

import { scoreErrors, aggregateReplayMetrics } from "./cfbOct17Replay.js";
import { reconcileWinnerAccuracyClaim } from "./cfbOct17Reconciliation.js";

export const OCT17_MATCHED_VERSION = "cfb-oct17-matched-cohort-v1";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function winnerPct(hits, n) {
  if (!n) return null;
  return round2((hits / n) * 100);
}

/**
 * Build matched-cohort comparison from replayOneGame rows.
 * Each row must include: eligible, original, rebuilt, actual, originalError, rebuiltError.
 */
export function buildMatchedCohortComparison(replayRows = [], { reportedWinnerPct = 57.1 } = {}) {
  const closeUniverse = replayRows.length;
  const gradedFinals = replayRows.filter(
    (r) => num(r.actual?.home) != null && num(r.actual?.away) != null
  );
  const rebuiltEligible = gradedFinals.filter((r) => r.rebuilt?.ok && r.eligible !== false);
  const matchedComparable = rebuiltEligible.filter(
    (r) => num(r.original?.home) != null && num(r.original?.away) != null
  );

  const scoreSide = (rows, projKey) => {
    let winnerHits = 0;
    let marginAbs = 0;
    let totalAbs = 0;
    let homeAbs = 0;
    let awayAbs = 0;
    let n = 0;
    for (const r of rows) {
      const ph = num(r[projKey]?.home);
      const pa = num(r[projKey]?.away);
      const ah = num(r.actual?.home);
      const aa = num(r.actual?.away);
      if (ph == null || pa == null || ah == null || aa == null) continue;
      n += 1;
      const err = scoreErrors(ph, pa, ah, aa);
      if (err.winnerCorrect) winnerHits += 1;
      marginAbs += Math.abs(err.marginError);
      totalAbs += Math.abs(err.totalError);
      homeAbs += Math.abs(err.homeError);
      awayAbs += Math.abs(err.awayError);
    }
    return {
      n,
      winnerHits,
      winnerPct: winnerPct(winnerHits, n),
      marginMae: n ? round2(marginAbs / n) : null,
      totalMae: n ? round2(totalAbs / n) : null,
      homeMae: n ? round2(homeAbs / n) : null,
      awayMae: n ? round2(awayAbs / n) : null,
    };
  };

  const originalMatched = scoreSide(matchedComparable, "original");
  const repairedMatched = scoreSide(matchedComparable, "rebuilt");

  // Aggregate helper for rebuilt-only eligible (may differ from matched n)
  const agg = aggregateReplayMetrics(replayRows);

  const winnerClaimReported = reconcileWinnerAccuracyClaim({
    correctWinners: originalMatched.winnerHits,
    eligibleN: originalMatched.n,
    reportedPct: reportedWinnerPct,
  });

  const delta = {
    winnerHits: repairedMatched.winnerHits - originalMatched.winnerHits,
    winnerPctPts:
      originalMatched.winnerPct != null && repairedMatched.winnerPct != null
        ? round2(repairedMatched.winnerPct - originalMatched.winnerPct)
        : null,
    marginMae:
      originalMatched.marginMae != null && repairedMatched.marginMae != null
        ? round2(repairedMatched.marginMae - originalMatched.marginMae)
        : null,
    totalMae:
      originalMatched.totalMae != null && repairedMatched.totalMae != null
        ? round2(repairedMatched.totalMae - originalMatched.totalMae)
        : null,
  };

  return {
    version: OCT17_MATCHED_VERSION,
    mode: "retrospective_diagnostic",
    promotionAuthorized: false,
    canAuthorizeWager: false,
    denominators: {
      closeUniverse,
      gradedFinals: gradedFinals.length,
      rebuiltEligible: rebuiltEligible.length,
      matchedComparable: matchedComparable.length,
      note:
        "matchedComparable = games with original CLOSE proj + rebuilt ok + actual finals — only fair original-vs-repaired comparison",
    },
    originalOnMatched: originalMatched,
    repairedOnMatched: repairedMatched,
    delta,
    winnerClaimOnMatchedOriginal: winnerClaimReported,
    aggregateReplayHelper: agg,
    caveats: [
      "Diagnostic reconstruction — not unbiased OOS promotion evidence",
      "Never overwrite original CLOSE snapshots",
      "Do not mix 40-game graded universe with 28-game helper subsets without labeling",
      "All Oct 17 CFB games completed — gradedFinals should equal closeUniverse when finals attached",
    ],
  };
}
