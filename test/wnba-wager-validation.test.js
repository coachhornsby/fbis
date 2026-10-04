import test from "node:test";
import assert from "node:assert/strict";
import { buildWnbaWagerValidation } from "../functions/lib/wnbaWagerValidation.js";

function rowsForBand(band,n,wins,{market="SPREAD",side="HOME",price=-110}={}){
  return Array.from({length:n},(_,i)=>({
    decision:"BET",market,side,confidence:band+5,
    result:i<wins?"WIN":"LOSS",win:i<wins?1:0,push:0,
    american_price:price,model_probability:(band+5)/100,
    clv_line:0.25,clv_price:0.5,event_start:"2026-07-01T23:00:00Z",
  }));
}

test("WNBA wager validation reports units ROI Brier CLV drawdown and monotonic confidence",()=>{
  const rows=[
    ...rowsForBand(60,25,14),
    ...rowsForBand(70,25,16),
    ...rowsForBand(80,25,18),
  ];
  const r=buildWnbaWagerValidation(rows);
  assert.equal(r.sampleN,75);
  assert.equal(r.confidenceMonotonicity.valid,true);
  assert.equal(r.confidenceMonotonicity.qualifiedBands,3);
  assert.ok(Number.isFinite(r.overall.units));
  assert.ok(Number.isFinite(r.overall.roi));
  assert.ok(Number.isFinite(r.overall.brier));
  assert.ok(Number.isFinite(r.overall.maxDrawdown));
  assert.equal(r.overall.avgClvLine,0.25);
  assert.equal(r.staking.validated,false);
});

test("WNBA confidence validation fails when higher confidence underperforms",()=>{
  const rows=[
    ...rowsForBand(60,25,16),
    ...rowsForBand(70,25,17),
    ...rowsForBand(80,25,12),
  ];
  const r=buildWnbaWagerValidation(rows);
  assert.equal(r.confidenceMonotonicity.valid,false);
});
