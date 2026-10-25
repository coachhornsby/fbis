import test from "node:test";
import assert from "node:assert/strict";
import {evaluateNbaMarketFreshness} from "../scripts/nba-market-freshness-gate.mjs";
const now=new Date("2026-10-25T12:00:00Z");
test("fresh NBA quotes pass but do not grant wager authority",()=>{
 const r=evaluateNbaMarketFreshness({snapshots:200,distinct_games:15,latest_capture:"2026-10-25T08:00:00Z"},{now});
 assert.equal(r.ok,true);assert.equal(r.canAuthorizeWager,false);
});
test("October 11 quote data fails for October 25 NBA projections",()=>{
 const r=evaluateNbaMarketFreshness({snapshots:364,distinct_games:43,latest_capture:"2026-10-11T17:52:56.976Z"},{now});
 assert.equal(r.ok,false);assert.ok(r.reasons.includes("NBA_MARKETS_STALE"));
});
test("missing and future-dated captures fail closed",()=>{
 for(const row of [{snapshots:0,latest_capture:null},{snapshots:1,latest_capture:"2026-10-26T12:00:00Z"}])
  assert.equal(evaluateNbaMarketFreshness(row,{now}).ok,false);
});
