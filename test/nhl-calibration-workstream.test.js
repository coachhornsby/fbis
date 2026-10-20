import test from "node:test";
import assert from "node:assert/strict";
import {
  NHL_BETTING_PROMOTION_FROZEN,
  NHL_CALIBRATION_PRIORITY,
  NHL_PROSPECTIVE_GAME_TARGET,
  nhlLivePromotionAllowed,
  challengerReport,
  orderChallengerReports,
  clusterGameSamples,
} from "../functions/lib/nhlCalibrationWorkstream.js";

test("NHL betting-model promotion stays frozen", () => {
  assert.equal(NHL_BETTING_PROMOTION_FROZEN, true);
  assert.equal(nhlLivePromotionAllowed(), false);
  assert.deepEqual(NHL_CALIBRATION_PRIORITY, ["totals", "goalie_contribution", "moneyline"]);
  assert.equal(NHL_PROSPECTIVE_GAME_TARGET, 100);
});

test("lines from the same game are one independent sample", () => {
  const clustered = clusterGameSamples([
    { gameId: "g1", probability: 0.4, outcome: 0, marketProbability: 0.42, evidenceClass: "POSITIVE" },
    { gameId: "g1", probability: 0.6, outcome: 1, marketProbability: 0.58, evidenceClass: "POSITIVE" },
    { gameId: "g2", probability: 0.55, outcome: 1, marketProbability: 0.5, evidenceClass: "POSITIVE" },
  ]);
  assert.equal(clustered.length, 2);
  assert.equal(clustered.find((row) => row.gameId === "g1").lines, 2);
  assert.equal(clustered.find((row) => row.gameId === "g1").probability, 0.5);
});

test("a challenger card reports skill, calibration, counts, and withholds unverified economics", () => {
  const rows = [1, 2, 3, 4].map((n) => ({
    gameId: `g${n}`,
    probability: 0.45,
    outcome: n % 2,
    marketProbability: 0.48,
    evidenceClass: "POSITIVE",
    clvVerified: false,
    clv: -0.02,
    pricesVerified: true,
    unitReturn: 0.4,
  }));
  rows.push(
    { gameId: "g1", probability: 0.55, outcome: 1, marketProbability: 0.52, evidenceClass: "POSITIVE" },
    { gameId: "g5", probability: 0.5, outcome: 0, evidenceClass: "MISSING" },
    { gameId: "g6", probability: 0.5, outcome: 1, evidenceClass: "NEGATIVE" },
  );
  const card = challengerReport({ family: "totals", challenger: "NHL-PRO-v2", rows });
  assert.equal(card.independentGames, 6);
  assert.equal(card.lineObservations, 7);
  assert.equal(card.sameGameLinesCollapsed, 1);
  assert.equal(card.marketGames, 4);
  assert.equal(card.missingMarketGames, 1);
  assert.equal(card.negativeMarketGames, 1);
  assert.equal(card.versus.deviggedMarket.n, 4);
  assert.equal(card.versus.hindsightBaseRate.label, "IN_SAMPLE_BASE_RATE_NOT_A_FORECAST");
  assert.ok(card.calibration.length >= 1);
  assert.equal(typeof card.brier, "number");
  assert.equal(typeof card.logLoss, "number");
  assert.equal(card.clv.status, "UNVERIFIED");
  assert.equal(card.clv.value, null);
  assert.equal(card.economicReturns.status, "UNVERIFIED_PRICES");
  assert.equal(card.economicReturns.units, null);
  assert.equal(card.canQualify, false);
  assert.equal(card.canAuthorizeWager, false);
});

test("verified closing prices report CLV, and returns stay withheld short of 100 games", () => {
  const rows = [1, 2].map((n) => ({
    gameId: `g${n}`,
    probability: 0.6,
    outcome: 1,
    marketProbability: 0.55,
    evidenceClass: "POSITIVE",
    clvVerified: true,
    clv: n === 1 ? -0.01 : 0.03,
    pricesVerified: true,
    unitReturn: 0.8,
  }));
  const card = challengerReport({ family: "moneyline", challenger: "shadow", rows });
  assert.equal(card.clv.status, "VERIFIED");
  assert.ok(Math.abs(card.clv.value - 0.01) < 1e-12);
  assert.equal(card.clv.games, 2);
  assert.equal(card.economicReturns.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(card.economicReturns.units, null);
});

test("totals are reported before goalie contribution and moneyline", () => {
  const ordered = orderChallengerReports([
    challengerReport({ family: "moneyline", challenger: "ml", rows: [] }),
    challengerReport({ family: "goalie_contribution", challenger: "goalie", rows: [] }),
    challengerReport({ family: "totals", challenger: "total", rows: [] }),
  ]);
  assert.deepEqual(ordered.map((row) => row.family), ["totals", "goalie_contribution", "moneyline"]);
});
