import test from "node:test";
import assert from "node:assert/strict";
import { auditConfidenceRows } from "../functions/lib/nhlWagerCalibration.js";

function rowsForBand(conf,n,{wins,profit=0.1,scope="GAME",clv=0.2}={}){
  const out=[];
  for(let i=0;i<n;i++) out.push({
    wager_scope:scope,
    confidence:conf,
    result:i<wins?"WIN":"LOSS",
    risk_units:1,
    profit_units:i<wins?profit:-1,
    clv_probability_pp:clv,
    calibrated_probability:conf/100,
    settled_at:`2026-10-${String((i%20)+1).padStart(2,"0")}T00:00:00Z`,
  });
  return out;
}

test("NHL confidence audit stays fail-closed on small samples",()=>{
  const rows=[...rowsForBand(65,10,{wins:7}),...rowsForBand(75,10,{wins:7}),...rowsForBand(85,10,{wins:8})];
  const out=auditConfidenceRows(rows,"GAME");
  assert.equal(out.validated,false);
  assert.ok(out.failures.includes("minimum-decisions"));
  assert.ok(out.failures.includes("minimum-populated-bins"));
});

test("NHL confidence audit rejects non-monotonic populated bins",()=>{
  const rows=[
    ...rowsForBand(65,50,{wins:35,profit:2}),
    ...rowsForBand(75,50,{wins:40,profit:2}),
    ...rowsForBand(85,50,{wins:30,profit:2}),
  ];
  const out=auditConfidenceRows(rows,"GAME");
  assert.equal(out.validated,false);
  assert.equal(out.metrics.monotonic,false);
  assert.ok(out.failures.includes("confidence-not-monotonic"));
});
