/**
 * NHL betting-market evaluation: settlement, de-vig and scoring.
 *
 * Evaluation only. Nothing here grants qualification or wager authority, and no
 * function returns `canQualify` or `canAuthorizeWager`. Settlement is defined per
 * market family because the three families do not share an outcome space:
 * moneyline is a two-way outcome on the winner, the puck line is a wager on goal
 * differential, and the total is a wager on combined team goals. Conflating the
 * last two is the defect this module exists to prevent.
 *
 * NHL scope rules, stated once:
 *   - A regular-season game always has a winner. A full-game moneyline cannot push.
 *   - Final score includes overtime and the shootout. A shootout awards exactly one
 *     goal to the winner, so a shootout game settles at a one-goal differential.
 *   - Half-goal lines cannot push. Integer lines can, and a push must be removed
 *     from the two-way price before it is compared with a model probability.
 *   - Regulation three-way markets (`num_6`) are a different outcome space with a
 *     draw branch. They are not comparable to full-game prices and are rejected.
 */

export const MARKET_FAMILY = Object.freeze({
  MONEYLINE: "moneyline",
  SPREAD: "spread",
  TOTAL: "total",
});

export const SETTLEMENT = Object.freeze({
  WIN: "WIN",
  LOSS: "LOSS",
  PUSH: "PUSH",
});

/** Period labels this module will settle. Regulation three-way is excluded on purpose. */
export const FULL_GAME_PERIOD = "full_game";
export const REGULATION_THREE_WAY_PERIOD = "num_6";

export function finalScoreValid(homeGoals, awayGoals) {
  return Number.isInteger(homeGoals) && Number.isInteger(awayGoals) && homeGoals >= 0 && awayGoals >= 0;
}

/**
 * Full-game moneyline. Returns WIN/LOSS only: a regular-season NHL game cannot end
 * level once overtime and the shootout are included, so an equal final score means
 * the score is not a settled full-game result and is rejected.
 */
export function settleMoneyline(homeGoals, awayGoals, side) {
  if (!finalScoreValid(homeGoals, awayGoals)) throw Error("NHL_FINAL_SCORE_INVALID");
  if (homeGoals === awayGoals) throw Error("NHL_FULL_GAME_CANNOT_BE_LEVEL");
  if (side !== "home" && side !== "away") throw Error("NHL_MONEYLINE_SIDE_INVALID");
  const homeWon = homeGoals > awayGoals;
  return (side === "home") === homeWon ? SETTLEMENT.WIN : SETTLEMENT.LOSS;
}

/**
 * Puck line. `line` is the handicap applied to `side`, so home -1.5 wins only when
 * the home team wins by two or more. Settles on goal differential, never on a
 * single team's goals.
 */
export function settleSpread(homeGoals, awayGoals, side, line) {
  if (!finalScoreValid(homeGoals, awayGoals)) throw Error("NHL_FINAL_SCORE_INVALID");
  if (side !== "home" && side !== "away") throw Error("NHL_SPREAD_SIDE_INVALID");
  if (!Number.isFinite(line)) throw Error("NHL_SPREAD_LINE_INVALID");
  const differential = side === "home" ? homeGoals - awayGoals : awayGoals - homeGoals;
  const margin = differential + line;
  if (margin > 0) return SETTLEMENT.WIN;
  if (margin < 0) return SETTLEMENT.LOSS;
  return SETTLEMENT.PUSH;
}

/** Total. Settles on combined team goals, never on differential. */
export function settleTotal(homeGoals, awayGoals, side, line) {
  if (!finalScoreValid(homeGoals, awayGoals)) throw Error("NHL_FINAL_SCORE_INVALID");
  if (side !== "over" && side !== "under") throw Error("NHL_TOTAL_SIDE_INVALID");
  if (!Number.isFinite(line)) throw Error("NHL_TOTAL_LINE_INVALID");
  const total = homeGoals + awayGoals;
  if (total === line) return SETTLEMENT.PUSH;
  const over = total > line;
  return (side === "over") === over ? SETTLEMENT.WIN : SETTLEMENT.LOSS;
}

export function settle({ family, period = FULL_GAME_PERIOD, side, line, homeGoals, awayGoals }) {
  if (period === REGULATION_THREE_WAY_PERIOD) throw Error("NHL_REGULATION_THREE_WAY_NOT_COMPARABLE_TO_FULL_GAME");
  if (period !== FULL_GAME_PERIOD) throw Error("NHL_PERIOD_NOT_SUPPORTED");
  if (family === MARKET_FAMILY.MONEYLINE) return settleMoneyline(homeGoals, awayGoals, side);
  if (family === MARKET_FAMILY.SPREAD) return settleSpread(homeGoals, awayGoals, side, line);
  if (family === MARKET_FAMILY.TOTAL) return settleTotal(homeGoals, awayGoals, side, line);
  throw Error("NHL_MARKET_FAMILY_NOT_SUPPORTED");
}

export function validDecimal(decimal) {
  const n = Number(decimal);
  return Number.isFinite(n) && n > 1;
}

/**
 * Multiplicative de-vig of a two-way price. Returns null rather than a guess when
 * either leg is missing, so a one-sided capture cannot masquerade as a fair price.
 */
export function devigTwoWay(decimalA, decimalB) {
  if (!validDecimal(decimalA) || !validDecimal(decimalB)) return null;
  const rawA = 1 / Number(decimalA);
  const rawB = 1 / Number(decimalB);
  const overround = rawA + rawB;
  if (!(overround > 0)) return null;
  return {
    rawA,
    rawB,
    overround,
    vigPercent: (overround - 1) * 100,
    fairA: rawA / overround,
    fairB: rawB / overround,
  };
}

/**
 * Realised return of a unit stake at decimal odds. A push returns the stake, which
 * is zero profit and must not be scored as a win.
 */
export function unitReturn(result, decimal) {
  if (!validDecimal(decimal)) return null;
  if (result === SETTLEMENT.PUSH) return 0;
  if (result === SETTLEMENT.WIN) return Number(decimal) - 1;
  if (result === SETTLEMENT.LOSS) return -1;
  throw Error("NHL_SETTLEMENT_RESULT_INVALID");
}

export function brierScore(probabilities, outcomes) {
  if (probabilities.length !== outcomes.length) throw Error("LENGTH_MISMATCH");
  if (!probabilities.length) return null;
  return probabilities.reduce((s, p, i) => s + (p - outcomes[i]) ** 2, 0) / probabilities.length;
}

export function logLoss(probabilities, outcomes, epsilon = 1e-12) {
  if (probabilities.length !== outcomes.length) throw Error("LENGTH_MISMATCH");
  if (!probabilities.length) return null;
  return -probabilities.reduce((s, p, i) => {
    const q = Math.min(1 - epsilon, Math.max(epsilon, p));
    return s + (outcomes[i] ? Math.log(q) : Math.log(1 - q));
  }, 0) / probabilities.length;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/**
 * Paired comparison of two probabilistic forecasts on the same events. Reports the
 * mean squared-error difference with its standard error and t statistic. Paired
 * because the alternative — comparing two unpaired Brier scores — confounds forecast
 * skill with differences in the underlying event base rates.
 */
export function pairedSkill(probsA, probsB, outcomes) {
  if (probsA.length !== probsB.length || probsA.length !== outcomes.length) throw Error("LENGTH_MISMATCH");
  const n = probsA.length;
  if (n < 2) return null;
  const d = probsA.map((p, i) => (p - outcomes[i]) ** 2 - (probsB[i] - outcomes[i]) ** 2);
  const m = mean(d);
  const variance = d.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  return {
    n,
    brierA: brierScore(probsA, outcomes),
    brierB: brierScore(probsB, outcomes),
    meanDifference: m,
    standardError: se,
    t: se > 0 ? m / se : null,
    aBetter: m < 0,
    significantAt95: se > 0 ? Math.abs(m / se) > 1.96 : false,
  };
}

/** Brier skill score against a reference forecast. Positive means the model is better. */
export function skillScore(brierModel, brierReference) {
  if (!(brierReference > 0)) return null;
  return 1 - brierModel / brierReference;
}

export function calibrationBins(probabilities, outcomes, edges = [0, 0.4, 0.5, 0.6, 0.7, 1.0001]) {
  if (probabilities.length !== outcomes.length) throw Error("LENGTH_MISMATCH");
  const bins = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const idx = probabilities.map((p, j) => (p >= lo && p < hi ? j : -1)).filter((j) => j >= 0);
    if (!idx.length) {
      bins.push({ bin: `${lo}-${hi}`, n: 0, meanPredicted: null, observed: null, gap: null });
      continue;
    }
    const meanPredicted = mean(idx.map((j) => probabilities[j]));
    const observed = mean(idx.map((j) => outcomes[j]));
    bins.push({ bin: `${lo}-${hi}`, n: idx.length, meanPredicted, observed, gap: meanPredicted - observed });
  }
  return bins;
}

/**
 * Sample size at which an observed mean difference would reach 95% significance,
 * holding the per-event spread constant. Answers "how many more games" without
 * implying the current point estimate is real.
 */
export function gamesNeededFor95(meanDifference, standardError, n) {
  if (!(Math.abs(meanDifference) > 0) || !(standardError > 0) || !(n > 0)) return null;
  const perEventSd = standardError * Math.sqrt(n);
  return Math.ceil(((1.96 * perEventSd) / Math.abs(meanDifference)) ** 2);
}
