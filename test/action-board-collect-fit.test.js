import test from "node:test";
import assert from "node:assert/strict";
import {
  planCandidateCollection,
} from "../functions/lib/actionApifyCollector.js";
import {
  fitMaxItemsToUsdBudget,
  estimateActorCostUsd,
  ACTION_APIFY_BOARD_SOFT_CAP_USD,
} from "../functions/lib/actionApifyShadow.js";

const starterEnv = {
  ACTION_APIFY_ENABLED: "true",
  ACTION_APIFY_PLAN: "starter",
  APIFY_TOKEN: "x",
};

test("fitMaxItemsToUsdBudget keeps estimate under soft board cap", () => {
  const fitted = fitMaxItemsToUsdBudget(
    { leagues: ["nfl"], periods: ["event"], maxItems: 200 },
    ACTION_APIFY_BOARD_SOFT_CAP_USD
  );
  assert.ok(fitted.maxItems < 200);
  assert.ok(fitted.estimatedCostUsd <= ACTION_APIFY_BOARD_SOFT_CAP_USD + 1e-9);
  assert.equal(
    estimateActorCostUsd(
      { leagues: ["nfl"], periods: ["event"], maxItems: fitted.maxItems },
      { gamesReturned: fitted.maxItems }
    ),
    fitted.estimatedCostUsd
  );
});

test("planCandidateCollection slate-sizes under harvest soft cap", () => {
  const plan = planCandidateCollection(starterEnv, {
    sport: "nfl",
    lifecycle: "pregame",
    maxItems: 200,
    slateExpected: 17,
  });
  assert.ok(plan.input.maxItems <= 17 + 8);
  assert.ok(plan.estimatedCostUsd < 1.0);
});

test("default starter maxItems no longer uses 200 safety cap", () => {
  const plan = planCandidateCollection(starterEnv, { sport: "nfl", lifecycle: "pregame" });
  assert.ok(plan.input.maxItems <= 80);
  assert.ok(plan.estimatedCostUsd < 1.0);
});
