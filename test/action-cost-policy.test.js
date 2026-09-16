import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_COST_DEFAULTS,
  actionCooldownMinutes,
  actionCostPolicyFromEnv,
  estimateActionRunUsd,
  evaluateActionSpendGuard,
  profileDailyCeilingUsd,
} from "../functions/lib/actionCostPolicy.js";

test("default ACTION hard budgets stay below total ops cap", () => {
  const policy = actionCostPolicyFromEnv({});
  assert.equal(policy.monthlyBudgetUsd, 22);
  assert.equal(policy.dailyBudgetUsd, 0.9);
  assert.equal(policy.maxSuccessfulRunsPerDay, 6);
  assert.equal(ACTION_COST_DEFAULTS.profileDailyCeilingsUsd.BASE, 0.35);
  assert.equal(ACTION_COST_DEFAULTS.profileDailyCeilingsUsd.PLAYER_PROPS, 0.72);
});

test("BASE collection requires a four-hour cooldown", () => {
  assert.equal(actionCooldownMinutes({ profile: "BASE", lifecycle: "pregame" }), 240);
  const now = new Date("2026-09-16T18:00:00.000Z");
  const guard = evaluateActionSpendGuard({
    now,
    monthToDateUsd: 5,
    dayToDateUsd: 0.05,
    successfulRunsToday: 2,
    lastSuccessAt: "2026-09-16T16:30:00.000Z",
    profile: "BASE",
    lifecycle: "pregame",
    maxItems: 20,
  });
  assert.equal(guard.allowed, false);
  assert.ok(guard.blocks.some((b) => b.code === "COLLECTION_COOLDOWN"));
});

test("PLAYER_PROPS collection uses three-hour cooldown", () => {
  assert.equal(actionCooldownMinutes({ profile: "PLAYER_PROPS" }), 180);
});

test("FINAL_PREGAME can refresh after ninety minutes", () => {
  assert.equal(actionCooldownMinutes({ profile: "MOVEMENT", lifecycle: "final_pregame" }), 90);
});

test("hard monthly budget blocks a run before it overshoots", () => {
  const guard = evaluateActionSpendGuard({
    monthToDateUsd: 21.9,
    dayToDateUsd: 0.1,
    successfulRunsToday: 1,
    maxItems: 20,
  });
  assert.equal(guard.allowed, false);
  assert.ok(guard.blocks.some((b) => b.code === "HARD_MONTHLY_BUDGET"));
});

test("hard daily budget blocks a run before it overshoots", () => {
  const guard = evaluateActionSpendGuard({
    monthToDateUsd: 8,
    dayToDateUsd: 0.8,
    successfulRunsToday: 3,
    profile: "MOVEMENT",
    maxItems: 20,
  });
  assert.equal(guard.allowed, false);
  assert.ok(guard.blocks.some((b) => b.code === "HARD_DAILY_BUDGET"));
});

test("BASE reserve prevents early market pulls from consuming prop/final budget", () => {
  assert.equal(profileDailyCeilingUsd("BASE"), 0.35);
  const guard = evaluateActionSpendGuard({
    monthToDateUsd: 8,
    dayToDateUsd: 0.22,
    successfulRunsToday: 1,
    profile: "BASE",
    maxItems: 20,
  });
  assert.equal(guard.allowed, false);
  assert.ok(guard.blocks.some((b) => b.code === "PROFILE_DAILY_RESERVE"));
});

test("PLAYER_PROPS can still run after BASE reserve closes", () => {
  const guard = evaluateActionSpendGuard({
    monthToDateUsd: 8,
    dayToDateUsd: 0.22,
    successfulRunsToday: 1,
    profile: "PLAYER_PROPS",
    maxItems: 24,
  });
  assert.equal(guard.allowed, true);
  assert.equal(guard.blocks.length, 0);
});

test("daily successful-run cap blocks runaway invocations even when cost is low", () => {
  const guard = evaluateActionSpendGuard({
    monthToDateUsd: 1,
    dayToDateUsd: 0.2,
    successfulRunsToday: 6,
    profile: "MOVEMENT",
    maxItems: 10,
  });
  assert.equal(guard.allowed, false);
  assert.ok(guard.blocks.some((b) => b.code === "DAILY_RUN_CAP"));
});

test("collection is allowed after cooldown when under all hard caps", () => {
  const now = new Date("2026-09-16T18:00:00.000Z");
  const guard = evaluateActionSpendGuard({
    now,
    monthToDateUsd: 5,
    dayToDateUsd: 0.05,
    successfulRunsToday: 2,
    lastSuccessAt: "2026-09-16T13:30:00.000Z",
    profile: "BASE",
    lifecycle: "pregame",
    maxItems: 20,
  });
  assert.equal(guard.allowed, true);
  assert.equal(guard.blocks.length, 0);
});

test("environment can tighten hard caps without code changes", () => {
  const policy = actionCostPolicyFromEnv({
    ACTION_APIFY_HARD_MONTHLY_BUDGET_USD: "12",
    ACTION_APIFY_HARD_DAILY_BUDGET_USD: "0.75",
    ACTION_APIFY_MAX_SUCCESSFUL_RUNS_PER_DAY: "4",
  });
  assert.equal(policy.monthlyBudgetUsd, 12);
  assert.equal(policy.dailyBudgetUsd, 0.75);
  assert.equal(policy.maxSuccessfulRunsPerDay, 4);
});

test("run estimate is conservative and bounded", () => {
  assert.equal(estimateActionRunUsd(20), 0.16);
  assert.equal(estimateActionRunUsd(24), 0.192);
  assert.equal(estimateActionRunUsd(1), 0.05);
});
