import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTLEMENT,
  MARKET_FAMILY,
  settleMoneyline,
  settleSpread,
  settleTotal,
  settle,
  devigTwoWay,
  unitReturn,
  brierScore,
  logLoss,
  pairedSkill,
  skillScore,
  calibrationBins,
  gamesNeededFor95,
} from "../functions/lib/nhlMarketEvaluation.js";

test("moneyline settles on the winner including overtime and shootout", () => {
  assert.equal(settleMoneyline(3, 2, "home"), SETTLEMENT.WIN);
  assert.equal(settleMoneyline(3, 2, "away"), SETTLEMENT.LOSS);
  assert.equal(settleMoneyline(2, 3, "home"), SETTLEMENT.LOSS);
  assert.equal(settleMoneyline(2, 3, "away"), SETTLEMENT.WIN);
});

test("a level full-game score is rejected rather than settled as a push", () => {
  // The NHL has no regular-season ties once the shootout is included, so a level
  // score means the result is regulation-only and the caller used the wrong scope.
  assert.throws(() => settleMoneyline(2, 2, "home"), /NHL_FULL_GAME_CANNOT_BE_LEVEL/);
});

test("puck line settles on goal differential, not on team goals", () => {
  // Home wins 4-2: differential +2 covers -1.5, and a 4-goal home total is irrelevant.
  assert.equal(settleSpread(4, 2, "home", -1.5), SETTLEMENT.WIN);
  assert.equal(settleSpread(4, 2, "away", 1.5), SETTLEMENT.LOSS);
  // Home wins by exactly one: -1.5 fails even though the team scored four.
  assert.equal(settleSpread(4, 3, "home", -1.5), SETTLEMENT.LOSS);
  assert.equal(settleSpread(4, 3, "away", 1.5), SETTLEMENT.WIN);
});

test("a one-goal shootout result settles the puck line at a one-goal differential", () => {
  // A shootout awards exactly one goal to the winner.
  assert.equal(settleSpread(3, 2, "home", -1.5), SETTLEMENT.LOSS);
  assert.equal(settleSpread(3, 2, "home", 1.5), SETTLEMENT.WIN);
  assert.equal(settleSpread(3, 2, "away", 1.5), SETTLEMENT.WIN);
});

test("integer puck lines push and half lines never do", () => {
  assert.equal(settleSpread(4, 3, "home", -1), SETTLEMENT.PUSH);
  assert.equal(settleSpread(4, 3, "away", 1), SETTLEMENT.PUSH);
  assert.equal(settleSpread(3, 3, "home", 0), SETTLEMENT.PUSH);
  for (const line of [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]) {
    assert.notEqual(settleSpread(5, 2, "home", line), SETTLEMENT.PUSH);
  }
});

test("total settles on combined goals and pushes only on integer lines", () => {
  assert.equal(settleTotal(4, 2, "over", 5.5), SETTLEMENT.WIN);
  assert.equal(settleTotal(4, 2, "under", 5.5), SETTLEMENT.LOSS);
  assert.equal(settleTotal(4, 2, "over", 6), SETTLEMENT.PUSH);
  assert.equal(settleTotal(4, 2, "under", 6), SETTLEMENT.PUSH);
  assert.equal(settleTotal(4, 2, "over", 6.5), SETTLEMENT.LOSS);
});

test("total and puck line disagree on the same score, proving they are separate markets", () => {
  // 5-1: total 6 pushes at 6, while the differential of 4 covers -1.5 comfortably.
  assert.equal(settleTotal(5, 1, "over", 6), SETTLEMENT.PUSH);
  assert.equal(settleSpread(5, 1, "home", -1.5), SETTLEMENT.WIN);
  // 3-3 is impossible as a full game, but 4-2 and 3-3 share a total of 6 with
  // opposite differentials, so a total line carries no differential information.
  assert.equal(settleTotal(4, 2, "over", 6), settleTotal(2, 4, "over", 6));
  assert.notEqual(settleSpread(4, 2, "home", -1.5), settleSpread(2, 4, "home", -1.5));
});

test("regulation three-way prices are refused, not silently settled as full game", () => {
  assert.throws(
    () => settle({ family: MARKET_FAMILY.MONEYLINE, period: "num_6", side: "home", homeGoals: 3, awayGoals: 2 }),
    /NHL_REGULATION_THREE_WAY_NOT_COMPARABLE_TO_FULL_GAME/,
  );
  assert.throws(
    () => settle({ family: MARKET_FAMILY.TOTAL, period: "num_1", side: "over", line: 2.5, homeGoals: 3, awayGoals: 2 }),
    /NHL_PERIOD_NOT_SUPPORTED/,
  );
});

test("invalid scores and sides throw instead of returning a result", () => {
  assert.throws(() => settleTotal(2.5, 1, "over", 5.5), /NHL_FINAL_SCORE_INVALID/);
  assert.throws(() => settleTotal(-1, 1, "over", 5.5), /NHL_FINAL_SCORE_INVALID/);
  assert.throws(() => settleSpread(3, 2, "draw", -1.5), /NHL_SPREAD_SIDE_INVALID/);
  assert.throws(() => settleTotal(3, 2, "over", null), /NHL_TOTAL_LINE_INVALID/);
});

test("de-vig removes the overround and needs both legs", () => {
  const d = devigTwoWay(1.97, 1.934);
  assert.ok(Math.abs(d.fairA + d.fairB - 1) < 1e-12);
  assert.ok(d.overround > 1);
  assert.ok(d.vigPercent > 0 && d.vigPercent < 10);
  // Fair probability sits below the raw implied probability once vig is removed.
  assert.ok(d.fairA < d.rawA);
  assert.equal(devigTwoWay(1.97, null), null);
  assert.equal(devigTwoWay(1.0, 2.0), null);
});

test("a push returns the stake rather than scoring as a win or a loss", () => {
  assert.equal(unitReturn(SETTLEMENT.PUSH, 1.91), 0);
  assert.equal(unitReturn(SETTLEMENT.LOSS, 1.91), -1);
  assert.ok(Math.abs(unitReturn(SETTLEMENT.WIN, 1.91) - 0.91) < 1e-12);
});

test("paired skill is computed on matched events with a standard error", () => {
  const outcomes = [1, 0, 1, 1, 0, 1, 0, 1];
  const sharp = [0.8, 0.2, 0.7, 0.9, 0.3, 0.6, 0.4, 0.75];
  const flat = outcomes.map(() => 0.5);
  const r = pairedSkill(sharp, flat, outcomes);
  assert.equal(r.n, 8);
  assert.ok(r.aBetter);
  assert.ok(r.brierA < r.brierB);
  assert.ok(r.standardError > 0);
  assert.equal(typeof r.significantAt95, "boolean");
  // Comparing a forecast with itself gives exactly zero difference and no skill.
  const self = pairedSkill(sharp, sharp, outcomes);
  assert.equal(self.meanDifference, 0);
  assert.equal(self.significantAt95, false);
});

test("brier, log loss and skill score behave on known inputs", () => {
  assert.equal(brierScore([1, 0], [1, 0]), 0);
  assert.equal(brierScore([0.5, 0.5], [1, 0]), 0.25);
  assert.ok(logLoss([0.5, 0.5], [1, 0]) - Math.log(2) < 1e-12);
  assert.ok(logLoss([1, 0], [1, 0]) < 1e-9);
  assert.equal(skillScore(0.2, 0.25), 1 - 0.8);
  assert.equal(skillScore(0.25, 0), null);
});

test("calibration bins report the predicted-minus-observed gap and keep empty bins", () => {
  const p = [0.1, 0.2, 0.45, 0.55, 0.65, 0.8, 0.85];
  const y = [0, 0, 1, 1, 1, 1, 0];
  const bins = calibrationBins(p, y);
  assert.equal(bins.length, 5);
  assert.equal(bins.reduce((s, b) => s + b.n, 0), p.length);
  const top = bins[bins.length - 1];
  assert.equal(top.n, 2);
  // Predicted 0.825 against an observed 0.5 is over-confidence, so the gap is positive.
  assert.ok(top.gap > 0);
});

test("games needed for significance scales with the squared effect size", () => {
  const small = gamesNeededFor95(0.01, 0.0164, 94);
  const double = gamesNeededFor95(0.02, 0.0164, 94);
  assert.ok(small > 900 && small < 1100);
  // Doubling the effect cuts the requirement roughly fourfold.
  assert.ok(Math.abs(small / double - 4) < 0.1);
  assert.equal(gamesNeededFor95(0, 0.01, 10), null);
});
