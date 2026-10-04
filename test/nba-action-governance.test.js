import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  actionMayDirectlyQualifyWager,
  actionMayAuthorizeWager,
  actionMayEnterPureGameFeatures,
} from "../functions/lib/actionObservationSeries.js";
import { ACTION_COST_DEFAULTS } from "../functions/lib/actionCostPolicy.js";
import { APIFY_SPORTS_HARD_CAP_USD } from "../functions/lib/sharedApifyBudget.js";

test("NBA preserves ACTION firewall and one-paid-run daily authority",()=>{
  assert.equal(actionMayEnterPureGameFeatures(),false);
  assert.equal(actionMayDirectlyQualifyWager(),false);
  assert.equal(actionMayAuthorizeWager(),false);
  assert.equal(ACTION_COST_DEFAULTS.maxSuccessfulRunsPerDay,1);
  assert.equal(APIFY_SPORTS_HARD_CAP_USD,25);
});

test("NBA workflows never start an ACTION paid acquisition",()=>{
  for(const path of [
    ".github/workflows/nba-prospective-shadow.yml",
    ".github/workflows/nba-market-evaluator.yml",
    ".github/workflows/nba-frozen-validation.yml"
  ]){
    const s=fs.readFileSync(path,"utf8");
    assert.equal(s.includes("/api/action-daily-async"),false,path);
    assert.equal(s.includes("ACTION_APIFY_ACTOR_ID"),false,path);
    assert.equal(s.includes("zen-studio~action"),false,path);
  }
});

test("ACTION daily collector retains exact one paid full-slate run rule",()=>{
  const s=fs.readFileSync("functions/api/action-daily-async.js","utf8");
  assert.match(s,/exactly one paid full-slate ACTION acquisition per CT day/);
  assert.match(s,/Never abort\/replace it from START/);
  assert.match(s,/includeLineMovement:false/);
  assert.match(s,/includeProps:false/);
  assert.match(s,/includeInjuries:false/);
});


test("NBA generated remote D1 SQL never emits BEGIN or COMMIT wrappers",()=>{
  for(const path of [
    "scripts/nba-shadow-project.mjs",
    "scripts/nba-game-decision-evaluate.mjs",
    "scripts/nba-market-evaluate.mjs"
  ]){
    const s=fs.readFileSync(path,"utf8");
    assert.equal(s.includes('["BEGIN;"'),false,path);
    assert.equal(s.includes('"COMMIT;"'),false,path);
  }
});
