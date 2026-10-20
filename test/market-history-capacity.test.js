import test from "node:test";
import assert from "node:assert/strict";
import {
  MEASURED_Q4_BASELINE,
  forecastCapacityExhaustion,
  recommendHotWindowMs,
  shouldPersistWsTickToD1,
  shouldBlockMarketHistoryWrite,
  buildVerifiedCapacityPlan,
  rowsPerHourFromSeries,
  MARKET_HISTORY_HOT_WINDOW_MS_LEGACY_7D,
  WS_TICK_COALESCE_MS,
} from "../functions/lib/marketHistoryCapacity.js";
import { MARKET_HISTORY_HOT_WINDOW_MS } from "../functions/lib/databaseTopology.js";
import { capacityAlertLevel } from "../functions/lib/databaseOwnership.js";
import { coalesceOffersForLedger, offerToLatestStateRow } from "../functions/lib/latestMarketState.js";

test("measured Q4 baseline rejects 7-day full-resolution hot storage", () => {
  const rates = rowsPerHourFromSeries(MEASURED_Q4_BASELINE.hourlyRows);
  const forecast = forecastCapacityExhaustion({
    usedBytes: MEASURED_Q4_BASELINE.usedBytes,
    bytesPerObservation: MEASURED_Q4_BASELINE.bytesPerObservation,
    rowsPerHour: rates,
  });
  assert.equal(forecast.sevenDayHotWindowFitsIn10Gb, false);
  assert.ok(forecast.sevenDayHotWindowBytesAtMedian > 10_000_000_000);
  assert.ok(forecast.scenarios.median.hoursUntilExhaustion < 7 * 24);
  assert.ok(forecast.scenarios.peak.hoursUntilExhaustion < forecast.scenarios.median.hoursUntilExhaustion);
});

test("recommended hot window is bounded and far below legacy 7 days", () => {
  const hot = recommendHotWindowMs();
  assert.ok(hot.hotWindowMs <= 24 * 3600 * 1000);
  assert.ok(hot.hotWindowMs >= 2 * 3600 * 1000);
  assert.ok(hot.hotWindowMs < MARKET_HISTORY_HOT_WINDOW_MS_LEGACY_7D);
  assert.equal(hot.legacySevenDayRejected, true);
  assert.ok(MARKET_HISTORY_HOT_WINDOW_MS <= 24 * 3600 * 1000);
  assert.ok(MARKET_HISTORY_HOT_WINDOW_MS < MARKET_HISTORY_HOT_WINDOW_MS_LEGACY_7D);
});

test("write gate blocks HIGH and CRITICAL capacity levels", () => {
  assert.equal(shouldBlockMarketHistoryWrite(capacityAlertLevel(8_500_000_000)).blocked, true);
  assert.equal(shouldBlockMarketHistoryWrite(capacityAlertLevel(9_000_000_000)).blocked, true);
  assert.equal(shouldBlockMarketHistoryWrite(capacityAlertLevel(7_900_000_000)).blocked, false);
});

test("WS tick coalesce skips redundant quotes inside the interval", () => {
  const first = shouldPersistWsTickToD1({ next: { contract_price: 0.55 } });
  assert.equal(first.persist, true);
  const skip = shouldPersistWsTickToD1({
    previous: { contract_price: 0.55, collected_at: new Date(Date.now() - 5_000).toISOString() },
    next: { contract_price: 0.55 },
    nowMs: Date.now(),
    coalesceMs: WS_TICK_COALESCE_MS,
  });
  assert.equal(skip.persist, false);
  assert.equal(skip.reason, "COALESCE_SKIP_REDUNDANT");
  const moved = shouldPersistWsTickToD1({
    previous: { contract_price: 0.55, collected_at: new Date(Date.now() - 5_000).toISOString() },
    next: { contract_price: 0.57 },
    nowMs: Date.now(),
  });
  assert.equal(moved.persist, true);
  assert.equal(moved.reason, "PRICE_MOVED");
});

test("coalesceOffersForLedger reduces repeated identical ticks", () => {
  const offers = [
    { source: "Polymarket US WebSocket", sport: "nhl", eventId: "e1", marketFamily: "moneyline", side: "home", sourceMarketId: "m1", sourceOutcomeId: "o1", contractPrice: 0.5 },
    { source: "Polymarket US WebSocket", sport: "nhl", eventId: "e1", marketFamily: "moneyline", side: "home", sourceMarketId: "m1", sourceOutcomeId: "o1", contractPrice: 0.5 },
  ];
  const once = coalesceOffersForLedger(offers, new Map(), { nowMs: Date.now() });
  assert.equal(once.ledgerOffers.length, 1);
  assert.equal(once.skipped.length, 1);
  const row = offerToLatestStateRow(offers[0]);
  assert.ok(row.state_key.includes("nhl"));
  assert.equal(row.can_authorize_wager, 0);
});

test("verified capacity plan documents live writer freeze and R2 architecture", () => {
  const plan = buildVerifiedCapacityPlan();
  assert.equal(plan.contract, "fbis-market-history-capacity-plan-v1");
  assert.equal(plan.verifiedLiveWriters.legacyWritesActive, false);
  assert.equal(plan.verifiedLiveWriters.q4ReceivingLiveObservations, true);
  assert.equal(plan.sevenDayPolicy.verdict, "REJECTED_UNSUSTAINABLE");
  assert.equal(plan.architecture.d1LatestState.table, "latest_market_state");
  assert.equal(plan.canAuthorizeWager, false);
  assert.ok(plan.operatorActions.length >= 4);
});
