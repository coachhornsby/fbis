import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  kalshiSignedHeaders, kalshiPrivateNotification, kalshiSubscribePrivate,
  kalshiGet, kalshiPaged, readKalshiAccount, KALSHI_ACCOUNT_PATHS
} from "../functions/lib/kalshiAccount.js";
import { onRequestGet, onRequestPost } from "../functions/api/kalshi-account.js";

async function envWithKey() {
  const pair = await webcrypto.subtle.generateKey({ name:"Ed25519" }, true, ["sign","verify"]);
  const der = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = "-----BEGIN PRIVATE KEY-----\n" + der.toString("base64") + "\n-----END PRIVATE KEY-----";
  return { KALSHI_API_KEY_ID:"kalshi-unit-test", KALSHI_PRIVATE_KEY_PEM:pem, FBIS_ACCOUNT_VIEW_TOKEN:"test-private-access" };
}
const sample = path => {
  if(path.endsWith("/balance"))return {balance_dollars:"55.2500",portfolio_value:1200,updated_ts:1781942400};
  if(path.endsWith("/positions"))return {market_positions:[{ticker:"KXNFLGAME-EX",position_fp:"10.00",market_exposure_dollars:"8.8000",realized_pnl_dollars:"1.5000",fees_paid_dollars:"0.1000"}],event_positions:[],cursor:""};
  if(path.endsWith("/orders"))return {orders:[{order_id:"ord-1",ticker:"KXNFLGAME-EX",status:"resting",remaining_count_fp:"3.00",yes_price_dollars:"0.5100"}],cursor:""};
  if(path.endsWith("/fills"))return {fills:[{fill_id:"fill-1",ticker:"KXNFLGAME-EX",count_fp:"2.00",yes_price_dollars:"0.5000",fee_cost:"0.0700",ts:1781942400}],cursor:""};
  throw Error("unexpected mock path");
};
test("Kalshi signs GET allowlist using recommended Ed25519 private key",async()=>{
  const env=await envWithKey();
  const timestamp=1781942400000,path=KALSHI_ACCOUNT_PATHS.balance;
  const headers=await kalshiSignedHeaders({keyId:env.KALSHI_API_KEY_ID,privateKeyPem:env.KALSHI_PRIVATE_KEY_PEM,path,timestamp,webCrypto:webcrypto});
  assert.equal(headers["KALSHI-ACCESS-TIMESTAMP"],String(timestamp));
  assert.ok(headers["KALSHI-ACCESS-SIGNATURE"]);
  await assert.rejects(()=>kalshiSignedHeaders({keyId:env.KALSHI_API_KEY_ID,privateKeyPem:env.KALSHI_PRIVATE_KEY_PEM,path:"/trade-api/v2/portfolio/order",webCrypto:webcrypto}),/not-allowed/);
  await assert.rejects(()=>kalshiSignedHeaders({keyId:env.KALSHI_API_KEY_ID,privateKeyPem:env.KALSHI_PRIVATE_KEY_PEM,path,method:"POST",webCrypto:webcrypto}),/not-allowed/);
});
test("snapshot only returns sanitized private data and exact money units",async()=>{
  const env=await envWithKey();
  const seen=[];
  const fetchImpl=async (uri, opts)=>{
    const url=new URL(uri);
    seen.push(url);
    assert.equal(opts.method,"GET");
    assert.ok(opts.headers["KALSHI-ACCESS-SIGNATURE"]);
    assert.equal(url.host,"external-api.kalshi.com");
    return Response.json(sample(url.pathname));
  };
  const result=await readKalshiAccount(env,{fetchImpl});
  assert.equal(result.ok,true);
  assert.equal(result.availableCashDollars,55.25);
  assert.equal(result.positionValueDollars,12);
  assert.equal(result.accountTotalDollars,67.25);
  assert.equal(result.positions[0].ticker,"KXNFLGAME-EX");
  assert.equal(result.positions[0].realizedPnlDollars,1.5);
  assert.equal(result.openOrders.length,1);
  assert.equal(result.recentFills.length,1);
  assert.equal(result.complete.positions,true);
  assert.equal(result.tradingEnabled,false);
  assert.ok(!JSON.stringify(result).includes(env.KALSHI_PRIVATE_KEY_PEM));
  assert.deepEqual(new Set(seen.map(u=>u.pathname)),new Set(Object.values(KALSHI_ACCOUNT_PATHS)));
});
test("pagination truncation stays visibly incomplete",async()=>{
  const env=await envWithKey();
  let counter=0;
  const result=await kalshiPaged("fills","fills",env,{maxPages:2,fetchImpl:async()=>Response.json({fills:[{fill_id:String(++counter)}],cursor:"next-"+counter})});
  assert.equal(result.ok,true);
  assert.equal(result.complete,false);
  assert.equal(result.items.length,2);
});
test("account endpoint fails closed without access token and never offers writes",async()=>{
  const env=await envWithKey();
  let called=false;
  const response=await onRequestGet({env,request:new Request("https://fbis.example/api/kalshi-account"),fetchImpl:async()=>{called=true;throw Error("must not fetch")}});
  assert.equal(response.status,403);
  assert.equal(called,false);
  assert.match(response.headers.get("cache-control"),/no-store/);
  const noCfg=await onRequestGet({env:{},request:new Request("https://fbis.example/api/kalshi-account")});
  assert.equal(noCfg.status,503);
  const post=await onRequestPost();
  assert.equal(post.status,405);
});
test("WS account notifications require a REST reconciliation and exclude user id",()=>{
  assert.deepEqual(kalshiSubscribePrivate(7),{id:7,cmd:"subscribe",params:{channels:["fill","market_positions","user_orders"]}});
  const result=kalshiPrivateNotification({type:"fill",msg:{market_ticker:"KXNFLGAME-EX",user_id:"private-user",trade_id:"secret"}});
  assert.equal(result.type,"fill");
  assert.equal(result.reconciliationRequired,true);
  assert.ok(!JSON.stringify(result).includes("private-user"));
  assert.equal(kalshiPrivateNotification({type:"error",msg:{}}),null);
});
