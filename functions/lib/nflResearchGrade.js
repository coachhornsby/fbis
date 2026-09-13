/**
 * NFL research-v0-form grade formulas.
 * Prospective live grades and historical replay share the same math;
 * classification (PROSPECTIVE vs REPLAY_VERIFIED) is attached by the caller.
 *
 * No Brier / log-loss unless calibrated probabilities exist on the row.
 */

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{
 *   projectedAway: number,
 *   projectedHome: number,
 *   actualAway: number,
 *   actualHome: number,
 *   marketHomeSpread?: number|null,
 *   marketTotal?: number|null,
 * }} input
 */
export function gradeResearchScoreProjection(input = {}) {
  const projectedAway = finite(input.projectedAway);
  const projectedHome = finite(input.projectedHome);
  const actualAway = finite(input.actualAway);
  const actualHome = finite(input.actualHome);
  if (
    projectedAway == null ||
    projectedHome == null ||
    actualAway == null ||
    actualHome == null
  ) {
    return { ok: false, reason: "incomplete-scores" };
  }

  const awayAbsError = Math.abs(actualAway - projectedAway);
  const homeAbsError = Math.abs(actualHome - projectedHome);

  const actualHomeMargin = actualHome - actualAway;
  const projectedHomeMargin = projectedHome - projectedAway;
  const marginError = projectedHomeMargin - actualHomeMargin;
  const marginAbsError = Math.abs(marginError);

  const actualTotal = actualHome + actualAway;
  const projectedTotal = projectedHome + projectedAway;
  const totalError = projectedTotal - actualTotal;
  const totalAbsError = Math.abs(totalError);

  let winnerCorrect = null;
  if (actualHome !== actualAway && projectedHome !== projectedAway) {
    winnerCorrect =
      Math.sign(actualHome - actualAway) === Math.sign(projectedHome - projectedAway);
  }

  const marketHomeSpread = finite(input.marketHomeSpread);
  const marketTotal = finite(input.marketTotal);
  let marketMarginAbsError = null;
  let pairedMarginDelta = null;
  let marketTotalAbsError = null;
  let pairedTotalDelta = null;

  if (marketHomeSpread != null) {
    const marketHomeMargin = -marketHomeSpread;
    marketMarginAbsError = Math.abs(actualHomeMargin - marketHomeMargin);
    pairedMarginDelta = marginAbsError - marketMarginAbsError;
  }
  if (marketTotal != null) {
    marketTotalAbsError = Math.abs(actualTotal - marketTotal);
    pairedTotalDelta = totalAbsError - marketTotalAbsError;
  }

  return {
    ok: true,
    awayAbsError,
    homeAbsError,
    actualHomeMargin,
    projectedHomeMargin,
    marginError,
    marginAbsError,
    actualTotal,
    projectedTotal,
    totalError,
    totalAbsError,
    winnerCorrect,
    marketHomeMargin: marketHomeSpread != null ? -marketHomeSpread : null,
    marketMarginAbsError,
    pairedMarginDelta,
    marketTotalAbsError,
    pairedTotalDelta,
    // Explicit non-claims
    isEv: false,
    isClv: false,
    note: "Forecast accuracy vs final and optional market baseline — not EV/CLV.",
  };
}

/**
 * Exact-version Model Lab cohort summary.
 * Never mixes historical replay into prospective N.
 */
export function summarizeExactVersionCohort(rows = [], { earlySampleMax = 30 } = {}) {
  const prospective = rows.filter((r) => r.classification === "PROSPECTIVE" && r.ok);
  const replay = rows.filter((r) => r.classification === "REPLAY_VERIFIED" && r.ok);
  const frozenProspective = rows.filter((r) => r.classification === "PROSPECTIVE");
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const pick = (list, key) => list.map((r) => r[key]).filter((v) => Number.isFinite(v));

  const build = (list, label) => {
    const n = list.length;
    const winnerRows = list.filter((r) => r.winnerCorrect != null);
    return {
      bucket: label,
      nFrozen: label === "PROSPECTIVE" ? frozenProspective.length : null,
      nGraded: n,
      earlySample: n > 0 && n < earlySampleMax,
      marginMae: mean(pick(list, "marginAbsError")),
      totalMae: mean(pick(list, "totalAbsError")),
      marginBias: mean(pick(list, "marginError")),
      totalBias: mean(pick(list, "totalError")),
      winnerAccuracy: winnerRows.length
        ? winnerRows.filter((r) => r.winnerCorrect).length / winnerRows.length
        : null,
      marketMarginMae: mean(pick(list, "marketMarginAbsError")),
      marketTotalMae: mean(pick(list, "marketTotalAbsError")),
      pairedMarginDelta: mean(pick(list, "pairedMarginDelta")),
      pairedTotalDelta: mean(pick(list, "pairedTotalDelta")),
    };
  };

  return {
    modelId: rows[0]?.modelId || null,
    modelVersion: rows[0]?.modelVersion || null,
    prospective: build(prospective, "PROSPECTIVE"),
    historicalReplay: build(replay, "REPLAY_VERIFIED"),
    label:
      prospective.length > 0 && prospective.length < earlySampleMax
        ? "EARLY SAMPLE"
        : null,
  };
}
