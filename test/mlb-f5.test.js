import test from "node:test";
import assert from "node:assert/strict";
import {
  americanEv,
  evaluateMlbF5Market,
  f5MoneylineProbabilities,
  f5SpreadProbabilities,
  f5TotalProbabilities,
  noVigPair,
} from "../functions/lib/mlbF5.js";

test("symmetric F5 means produce symmetric moneyline probabilities and tie mass", () => {
  const p = f5MoneylineProbabilities(2.2, 2.2);
  assert.ok(Math.abs(p.home.win - p.away.win) < 1e-6);
  assert.ok(p.home.push > 0.1);
  assert.ok(Math.abs(p.home.conditionalWin - 0.5) < 1e-6);
});

test("higher total mean increases over probability", () => {
  const low = f5TotalProbabilities(1.5, 1.5, 4.5);
  const high = f5TotalProbabilities(3.0, 3.0, 4.5);
  assert.ok(high.over.win > low.over.win);
});

test("half-run spread has no push", () => {
  const p = f5SpreadProbabilities(2.6, 2.0, -0.5);
  assert.ok(p.home.push < 1e-9);
  assert.ok(Math.abs(p.home.win + p.home.loss - 1) < 1e-5);
});

test("no-vig pair normalizes bookmaker probabilities", () => {
  const p = noVigPair(-110, -110);
  assert.ok(Math.abs(p.a - 0.5) < 1e-9);
  assert.ok(Math.abs(p.b - 0.5) < 1e-9);
  assert.ok(p.hold > 0);
});

test("EV handles push probability by using win and loss only", () => {
  const ev = americanEv({ pWin: 0.5, pLoss: 0.4, price: -110 });
  assert.ok(ev > 0.05 && ev < 0.06);
});

test("market evaluator surfaces research signal but never wager authority", () => {
  const result = evaluateMlbF5Market({
    projection: { home: 3.2, away: 1.4 },
    market: {
      homeMl: -105,
      awayMl: -105,
      spread: -0.5,
      spreadHomePrice: -105,
      spreadAwayPrice: -105,
      total: 3.5,
      overPrice: -105,
      underPrice: -105,
      book: "Pinnacle",
    },
    lineupsOfficial: true,
  });
  assert.equal(result.canQualify, false);
  assert.equal(result.qualificationState, "RESEARCH_ONLY");
  assert.ok(result.markets.length >= 6);
  assert.ok(result.bestResearchSignal);
  assert.equal(result.bestResearchSignal.researchQualified, true);
});

test("market evaluator fails closed when no F5 quote exists", () => {
  const result = evaluateMlbF5Market({ projection: { home: 2.2, away: 2.1 }, market: null });
  assert.equal(result.available, false);
  assert.equal(result.reason, "F5_MARKET_UNAVAILABLE");
  assert.equal(result.canQualify, false);
});
