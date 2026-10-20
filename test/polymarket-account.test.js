import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  readPolymarketUsAccount, polymarketAccountPages, polymarketAccountBalance,
  polymarketAccountGet, polymarketAccountActivity,
} from "../functions/lib/polymarketUsAccount.js";
import { signedPolymarketUsAccountGetHeaders } from "../functions/lib/polymarketUsSignedWs.js";
import { onRequestGet, onRequestPost } from "../functions/api/polymarket-account.js";

const env = () => ({
  POLYMARKET_US_KEY_ID: "00000000-0000-4000-8000-000000000001",
  POLYMARKET_US_SECRET_KEY: Buffer.alloc(64, 21).toString("base64"),
  FBIS_ACCOUNT_VIEW_TOKEN: "a-private-view-token",
});
const mock = async (url, options) => {
  assert.equal(options.method, "GET");
  assert.ok(options.headers["X-PM-Signature"]);
  assert.ok(options.headers["X-PM-Access-Key"]);
  const path = new URL(url).pathname;
  if (path.endsWith("/balances")) return Response.json({
    balances: [{ currency: "USD", currentBalance: 125.50, buyingPower: 75.25,
      assetNotional: 40.75, unsettledFunds: 2, openOrders: 7,
      pendingWithdrawals: [{ destinationAccountName: "MUST_NOT_LEAK", bankId: "MUST_NOT_LEAK" }] }],
  });
  if (path.endsWith("/positions")) return Response.json({
    positions: { "nfl-test-market": { netPositionDecimal: "4.5", cashValue: {value:"3.45"},
      cost: {value:"2.40"}, realized: {value:"0.35"}, expired:false,
      marketMetadata:{ title: "Example NFL outcome" }} },
    eof:true,
  });
  if (path.endsWith("/activities")) return Response.json({
    activities:[
      {type:"ACTIVITY_TYPE_TRADE",trade:{id:"trade-1",marketSlug:"nfl-test-market",
        qtyDecimal:"2.5",price:{value:"0.51"},costBasis:{value:"1.275"},
        realizedPnl:{value:"0.10"},createTime:"2026-10-20T06:00:00Z"}},
      {type:"ACTIVITY_TYPE_ACCOUNT_BALANCE_CHANGE",accountBalanceChange:{transactionId:"MUST_NOT_LEAK",
        destinationAccountName:"MUST_NOT_LEAK"}},
    ],eof:true,
  });
  if (path.endsWith("/orders/open")) return Response.json({
    orders:[{id:"o1",marketSlug:"nfl-test-market",marketMetadata:{title:"Example NFL outcome"},
      side:"ORDER_SIDE_BUY",outcomeSide:"OUTCOME_SIDE_YES",leavesQuantity:3,
      price:{value:"0.45"},createTime:"2026-10-20T05:00:00Z"}],
  });
  throw Error("unexpected path "+path);
};

test("private Polymarket US snapshot has distinct currency units, orders, positions and trades",async()=>{
  const account = env();
  const result = await readPolymarketUsAccount(account,{fetchImpl:mock});
  assert.equal(result.ok,true);
  assert.equal(result.provider,"polymarket_us");
  assert.equal(result.balances[0].cashBalance,125.5);
  assert.equal(result.balances[0].buyingPower,75.25);
  assert.equal(result.balances[0].assetNotional,40.75);
  assert.equal(result.accountTotalVerified,false);
  assert.equal(result.positions[0].quantity,4.5);
  assert.equal(result.openOrders[0].remaining,3);
  assert.equal(result.recentTrades.length,1);
  assert.equal(result.recentTrades[0].price,0.51);
  assert.equal(result.complete.positions,true);
  assert.equal(result.complete.recentTrades,true);
  assert.equal(result.tradingEnabled,false);
  assert.ok(!JSON.stringify(result).includes("MUST_NOT_LEAK"));
  assert.ok(!JSON.stringify(result).includes(account.POLYMARKET_US_SECRET_KEY));
});
test("private account endpoint denies access before contacting provider and rejects POST",async()=>{
  const account=env();
  let contacted=false;
  const response=await onRequestGet({request:new Request("https://example.com/api/polymarket-account"),
    env:account,fetchImpl:async()=>{contacted=true;throw Error("must not fetch");}});
  assert.equal(response.status,403);
  assert.equal(contacted,false);
  assert.equal((await response.json()).code,"PORTFOLIO_ACCESS_DENIED");
  assert.match(response.headers.get("cache-control"),/no-store/);
  assert.equal((await onRequestPost()).status,405);
  const unconfigured=await onRequestGet({request:new Request("https://example.com/api/polymarket-account"),env:{}});
  assert.equal(unconfigured.status,503);
});
test("authorized private endpoint returns only sanitized account data",async()=>{
  const account=env();
  const response=await onRequestGet({request:new Request("https://example.com/api/polymarket-account",{
    headers:{"x-fbis-account-token":account.FBIS_ACCOUNT_VIEW_TOKEN},
  }),env:account,fetchImpl:mock});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.ok,true);
  assert.ok(!JSON.stringify(data).includes("MUST_NOT_LEAK"));
});
test("provider 401 fails closed with statuses not response body",async()=>{
  const result=await readPolymarketUsAccount(env(),{
    fetchImpl:async()=>new Response('{"access":"DO_NOT_ECHO"}',{status:401}),
  });
  assert.equal(result.ok,false);
  assert.equal(result.code,"POLYMARKET_UPSTREAM_FAILED");
  assert.equal(result.failures.balances.status,401);
  assert.equal(result.failures.orders.status,401);
  assert.ok(!JSON.stringify(result).includes("DO_NOT_ECHO"));
});
test("incomplete pagination is never labeled complete",async()=>{
  const pages=await polymarketAccountPages("positions",env(),{maxPages:2,fetchImpl:async()=>Response.json({positions:{"one":{netPosition:3}},eof:false,nextCursor:"next"})});
  assert.equal(pages.ok,true);
  assert.equal(pages.complete,false);
});
test("account signing allowlist permits GET /v1/orders/open but rejects trading",async()=>{
  const account=env();
  const headers=await signedPolymarketUsAccountGetHeaders({
    keyId:account.POLYMARKET_US_KEY_ID,secretKey:account.POLYMARKET_US_SECRET_KEY,
    path:"/v1/orders/open",webCrypto,
  });
  assert.ok(headers["X-PM-Signature"]);
  await assert.rejects(()=>signedPolymarketUsAccountGetHeaders({
    keyId:account.POLYMARKET_US_KEY_ID,secretKey:account.POLYMARKET_US_SECRET_KEY,
    path:"/v1/orders",
  }),/private-read-path-not-allowed/);
});
test("invalid balance array and bank transfer records are excluded",async()=>{
  assert.equal(polymarketAccountBalance({}),null);
  assert.equal(polymarketAccountActivity({type:"ACTIVITY_TYPE_ACCOUNT_BALANCE_CHANGE",accountBalanceChange:{bankId:"secret"}}),null);
  const result=await readPolymarketUsAccount(env(),{fetchImpl:async(url,opts)=>{
    const path=new URL(url).pathname;
    if(path.endsWith("/balances"))return Response.json({balances:{"USD":45}});
    return mock(url,opts);
  }});
  assert.equal(result.ok,false);
  assert.equal(result.code,"POLYMARKET_BAD_RESPONSE");
});
