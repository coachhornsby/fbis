import test from "node:test";
import assert from "node:assert/strict";
import {privateOrderExecution,canEnhanceRestFill} from "../functions/lib/polymarketPrivateOrders.js";
import {onRequestPost,onRequestGet} from "../functions/api/polymarket-private-stream-sign.js";

const valid={
 orderSubscriptionUpdate:{execution:{
   type:"EXECUTION_TYPE_FILL",tradeId:"D9HSGDHG91KR",
   lastShares:"3.78",lastPx:{value:"0.23",currency:"USD"},
   commissionNotionalCollected:{value:"0.02",currency:"USD"},
   transactTime:"2026-10-24T01:53:01.638Z",
   order:{id:"order-123",marketSlug:"asc-cfb-ncst-stan-2026-10-23-neg-7pt5",
      side:"ORDER_SIDE_BUY",intent:"ORDER_INTENT_BUY_SHORT",outcomeSide:"OUTCOME_SIDE_NO",
      state:"ORDER_STATE_FILLED",quantity:3.78,cumQuantity:3.78,leavesQuantity:0}
 }}};
test("private order execution links documented trade ID, NO outcome and fee",()=>{
 const e=privateOrderExecution(valid);
 assert.equal(e.fillId,"D9HSGDHG91KR");
 assert.equal(e.groupId,"order-123");assert.equal(e.side,"NO");
 assert.equal(e.action,"BUY");assert.equal(e.price,.23);
 assert.equal(e.fee,.02);assert.equal(e.quantity,3.78);
 assert.equal(e.provider,"Polymarket US");
 const prior={provider:"Polymarket US",fill_id:e.fillId,market:e.market,
  group_id:e.fillId,side:"UNKNOWN",action:"UNKNOWN",
  quantity:3.78,unit_price:.23,fee_usd:null};
 assert.equal(canEnhanceRestFill(prior,e),true);
 assert.equal(canEnhanceRestFill({...prior,market:"other"},e),false);
 assert.equal(canEnhanceRestFill({...prior,unit_price:.52},e),false);
 assert.equal(canEnhanceRestFill({...prior,quantity:4.78},e),false);
});
test("private order stream cannot invent unsettled, canceled, partial or ambiguous bets",()=>{
 const clone=()=>structuredClone(valid);
 let event=clone();event.orderSubscriptionUpdate.execution.type="EXECUTION_TYPE_PARTIAL_FILL";
 assert.equal(privateOrderExecution(event),null);
 event=clone();event.orderSubscriptionUpdate.execution.order.cumQuantity=10;
 assert.equal(privateOrderExecution(event),null);
 event=clone();event.orderSubscriptionUpdate.execution.order.state="ORDER_STATE_PARTIALLY_FILLED";
 assert.equal(privateOrderExecution(event),null);
 event=clone();event.orderSubscriptionUpdate.execution.order.intent="ORDER_INTENT_SELL_LONG";
 event.orderSubscriptionUpdate.execution.order.side="ORDER_SIDE_SELL";
 event.orderSubscriptionUpdate.execution.order.outcomeSide="OUTCOME_SIDE_YES";
 assert.equal(privateOrderExecution(event).action,"SELL");
 event=clone();event.orderSubscriptionUpdate.execution.order.outcomeSide="OUTCOME_SIDE_YES";
 assert.equal(privateOrderExecution(event),null);
 event=clone();event.orderSubscriptionUpdate.execution.commissionNotionalCollected={value:".03",currency:"EUR"};
 assert.equal(privateOrderExecution(event).fee,null);
 event=clone();delete event.orderSubscriptionUpdate.execution.tradeId;
 assert.equal(privateOrderExecution(event),null);
});
test("private signing endpoint rejects public requests and only signs private WS",async()=>{
 const env={HARVEST_SECRET:"private-backend-identity",POLYMARKET_US_KEY_ID:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  POLYMARKET_US_SECRET_KEY:Buffer.alloc(64,7).toString("base64")};
 const denied=await onRequestPost({request:new Request("https://fbis/api/polymarket-private-stream-sign",{method:"POST"}),env});
 assert.equal(denied.status,403);
 const allowed=await onRequestPost({request:new Request("https://fbis/api/polymarket-private-stream-sign",
   {method:"POST",headers:{"x-harvest-secret":env.HARVEST_SECRET}}),env});
 const body=await allowed.json();
 assert.equal(allowed.status,200);
 assert.equal(body.path,"/v1/ws/private");
 assert.ok(body.headers["X-PM-Signature"]);
 assert.ok(!JSON.stringify(body).includes(env.POLYMARKET_US_SECRET_KEY));
 const get=await onRequestGet();assert.equal(get.status,405);
});
