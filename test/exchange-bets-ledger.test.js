import test from "node:test";
import assert from "node:assert/strict";
import {readExchangeTickets} from "../functions/lib/exchangeBetLedger.js";
test("private execution ledger stays idempotent and groups fills by provider order",async()=>{
 const rows=[
 {provider:"Kalshi",fill_id:"f1",group_id:"order123",market:"KX-NFL",side:"YES",action:"BUY",quantity:2,unit_price:.4,fee_usd:.02,occurred_at:"2026-10-21T01:00:00Z",market_label:"NFL"},
 {provider:"Kalshi",fill_id:"f2",group_id:"order123",market:"KX-NFL",side:"YES",action:"BUY",quantity:3,unit_price:.5,fee_usd:.03,occurred_at:"2026-10-21T01:01:00Z",market_label:"NFL"}];
 const db={prepare:(sql)=>({all:async()=>({results:sql.includes("FROM exchange_bet_settlements")?[]:rows})})};
 const r=await readExchangeTickets(db);
 assert.equal(r.observedFills,2);assert.equal(r.tickets.length,1);
 assert.equal(r.tickets[0].risk,2.35);
 assert.equal(r.tickets[0].status,"OPEN");
});
test("settlement matches only unique full position without sell offsets",async()=>{
 const rows=[{provider:"Kalshi",fill_id:"f1",group_id:"o1",market:"KX-NFL",side:"YES",action:"BUY",quantity:2,unit_price:.4,fee_usd:.02,occurred_at:"2026-10-21T01:00:00Z",market_label:"NFL"}];
 const settles=[{provider:"Kalshi",market:"KX-NFL",outcome:"YES",yes_contracts:2,no_contracts:0,revenue_usd:2,settlement_fee_usd:0,settled_at:"2026-10-22T00:00:00Z"}];
 const db={prepare:(sql)=>({all:async()=>({results:sql.includes("FROM exchange_bet_settlements")?settles:rows})})};
 const r=await readExchangeTickets(db);assert.equal(r.tickets[0].status,"WON");assert.equal(r.tickets[0].profit,1.18);
 rows.push({...rows[0],fill_id:"sell",group_id:"osell",action:"SELL",quantity:1});
 const r2=await readExchangeTickets(db);assert.equal(r2.tickets[0].status,"REVIEW");
});

test("outcome alone never grades when settlement cash contradicts the contract payout",async()=>{
 const rows=[{provider:"Kalshi",fill_id:"f",group_id:"o",market:"KX-TEST",side:"YES",action:"BUY",quantity:2,unit_price:.4,fee_usd:.02,occurred_at:"2026-10-21T01:00:00Z",market_label:"Test"}];
 const settlements=[{provider:"Kalshi",market:"KX-TEST",outcome:"YES",yes_contracts:2,revenue_usd:1.35,settled_at:"2026-10-22T00:00:00Z"}];
 const db={prepare:sql=>({all:async()=>({results:sql.includes("FROM exchange_bet_settlements")?settlements:rows})})};
 const result=await readExchangeTickets(db);
 assert.equal(result.tickets[0].status,"REVIEW");
 assert.equal(result.tickets[0].profit,null);
});
