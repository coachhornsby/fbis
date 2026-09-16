import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_COST_DEFAULTS,
  actionCooldownMinutes,
  actionCostPolicyFromEnv,
  evaluateActionSpendGuard,
} from "../functions/lib/actionCostPolicy.js";

test("default ACTION hard budgets reserve room for pro props while staying under total ops cap", () => {
  const policy = actionCostPolicyFromEnv({});
  assert.equal(policy.monthlyBudgetUsd, 22);
  assert.equal(policy.dailyBudgetUsd, 0.9);
  assert.equal(policy.maxSuccessfulRunsPerDay, 6);
  assert.deepEqual(policy, ACTION_COST_DEFAULTS);
});

test("BASE collection requires a four-hour cooldown", () => {
  assert.equal(actionCooldownMinutes({ profile: "BASE", lifecycle: "pregame" }), 240);
  const now = new Date("2026-09-16T18:00:00.000Z");
  const guard = evaluateActionSpendGuard({
    now,
    monthToDateUsd: 5,
    dayToDateUsd: 0.5,
    successfulRunsToday: 2,
    lastSuccessAt: "2026-09-16T16:30:00.000Z",
    profile: "BASE",
    lifecycle: "pregame",
  });
  assert.equal(guard.allowed, false);
  assert.equal(guard.blocks[0].code, "COLLECTION_COOLDOWN");
});

test("PLAYER_PROPS collection uses three-hour cooldown", () => {
  assert.equal(actionCooldownMinutes({ profile: "PLAYER_PROPS" }), 180);
});

test("FINAL_PREGAME can refresh after ninety minutes", () => {
  assert.equal(actionCooldownMinutes({ profile: "MOVEMENT", lifecycle: "final_pregame" }), 90);
});

test("hard monthly budget blocks paid collection", () => {
  const guard = evaluateActionSpendGuard({
    monthToDateUsd: 22,
    dayToDateUsd: 0.1,
    successfulRunsToday: 1,
  });
  assert.equal(guard.allowed, false);
  assert.ok(guard.blocks.some((b) => b.code === "HARD_MONTHLY_BUDGET"));
});

test("hard daily budget blocks paid collection", () => {
  const guard = evaluateActionSpendGuard({
    monthToDateUsd: 8,
    dayToDateUsd: 0.9,
    successfulRunsToday: 3,
  });
  assert.equal(guard.allowed, false);
  assert.ok(guard.blocks.some((b) => b.code === "HARD_DAILY_BUDGET"));
});

test("daily successful-run cap blocks runaway invocations even when cost is low", () => {
  const guard = evaluateActionSpendGuard({
    monthToDateUsd: 1,
    dayToDateUsd: 0.2,
    successfulRunsToday: 6,
  });
  assert.equal(guard.allowed, false);
  assert.ok(guard.blocks.some((b) => b.code === "DAILY_RUN_CAP"));
});

test("collection is allowed after cooldown when under all hard caps", () => {
  const now = new Date("2026-09-16T18:00:00.000Z");
  const guard = evaluateActionSpendGuard({
    now,
    monthToDateUsd: 5,
    dayToDateUsd: 0.4,
    successfulRunsToday: 2,
    lastSuccessAt: "2026-09-16T13:30:00.000Z",
    profile: "BASE",
    lifecycle: "pregame",
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
