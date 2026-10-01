import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestPost } from "../functions/api/action-research-pull.js";

function req(url, init={}) {
  return new Request(url, {
    ...init,
    headers: { "x-harvest-secret":"secret", "content-type":"application/json", ...(init.headers||{}) },
  });
}
function baseEnv(overrides={}) {
  return {
    HARVEST_SECRET:"secret",
    APIFY_TOKEN:"token",
    ACTION_APIFY_PLAN:"starter",
    ACTION_APIFY_MONTHLY_BUDGET_USD:"25",
    ...overrides,
  };
}

test("historical Action research GET plans completed odds-only pull without production authority", async () => {
  const res=await onRequestGet({
    request:req("https://example.test/api/action-research-pull?sport=cfb&season=2025&week=4&gameStatus=complete&maxItems=120"),
    env:baseEnv(),
  });
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.ok,true);
  assert.equal(body.executed,false);
  assert.equal(body.plan.input.season,2025);
  assert.equal(body.plan.input.week,4);
  assert.equal(body.plan.input.gameStatus,"complete");
  assert.equal(body.plan.input.onlyWithOdds,true);
  assert.ok(body.plan.estimatedCostUsd <= 0.75 + 1e-9);
  assert.equal(body.inProductionRouter,false);
  assert.equal(body.canQualify,false);
  assert.equal(body.canAuthorizeWager,false);
});

test("historical Action research rejects unauthorized access", async () => {
  const res=await onRequestGet({
    request:new Request("https://example.test/api/action-research-pull?sport=cfb"),
    env:baseEnv(),
  });
  assert.equal(res.status,401);
});

test("historical Action research hard-clamps configured budget to $25", async () => {
  const res=await onRequestGet({
    request:req("https://example.test/api/action-research-pull?sport=wnba&season=2025&maxItems=200"),
    env:baseEnv({ACTION_APIFY_MONTHLY_BUDGET_USD:"999"}),
  });
  const body=await res.json();
  assert.equal(body.budget.monthlyBudgetUsd,25);
  assert.ok(body.plan.estimatedCostUsd <= 0.75 + 1e-9);
});

test("POST without sport fails before any Actor execution", async () => {
  const res=await onRequestPost({
    request:req("https://example.test/api/action-research-pull",{method:"POST",body:JSON.stringify({})}),
    env:baseEnv(),
  });
  assert.equal(res.status,400);
  const body=await res.json();
  assert.equal(body.error,"sport-required");
});
