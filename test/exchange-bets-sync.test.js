import test from "node:test";
import assert from "node:assert/strict";
import {kalshiExecution,polymarketExecution,groupExecutions} from "../functions/lib/exchangeBetLedger.js";
test("confirmed Kalshi buy fills aggregate by order, fees counted once per fill",()=>{
 const a=kalshiExecution({fill_id:"a",order_id:"o1",ticker:"KX-TEST",side:"yes",action:"buy",count_fp:"2",yes_price_dollars:"0.4",fee_cost:"0.02",created_time:"2026-10-21T14:00:00Z"});
 const b=kalshiExecution({fill_id:"b",order_id:"o1",ticker:"KX-TEST",side:"yes",action:"buy",count_fp:"3",yes_price_dollars:"0.5",fee_cost:"0.03",created_time:"2026-10-21T14:01:00Z"});
 const xs=groupExecutions([a,b]);
 assert.equal(xs.length,1);assert.equal(xs[0].fillCount,2);assert.equal(xs[0].contracts,5);
 assert.equal(xs[0].risk,2.35);assert.equal(xs[0].toWin,2.65);assert.equal(xs[0].id,"KALSHI:o1:YES");
});
test("unknown Poly side never invents a bet",()=>{
 const a=polymarketExecution({type:"ACTIVITY_TYPE_TRADE",trade:{id:"t",marketSlug:"m",qty:"2",price:"0.4",createTime:"2026-10-21T13:00:00Z"}});
 assert.equal(groupExecutions([a]).length,0);
});
test("sells and resting orders never create independent bets",()=>{
 assert.equal(groupExecutions([kalshiExecution({fill_id:"1",order_id:"o",ticker:"KX",side:"no",action:"sell",count_fp:"2",no_price_dollars:"0.4",created_time:"2026-10-21T13:00:00Z"})]).length,0);
});
test("Polymarket explicit confirmed buy is eligible",()=>{
 const a=polymarketExecution({type:"ACTIVITY_TYPE_TRADE",trade:{id:"p1",orderId:"pord",marketSlug:"atp-test",outcomeSide:"YES",intent:"BUY",qtyDecimal:"3",price:"0.55",state:"FILLED",createTime:"2026-10-21T12:00:00Z"}});
 const rows=groupExecutions([a]);assert.equal(rows.length,1);assert.equal(rows[0].id,"PMUS:pord:YES");assert.equal(rows[0].risk,1.65);
});
