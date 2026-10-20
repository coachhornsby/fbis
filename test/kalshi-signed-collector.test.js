import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {captureSignedKalshiMarkets,captureSignedKalshiExchangeStatus,kalshiSignedReadProxy}
  from "../functions/lib/kalshiSignedCollector.js";
import {onRequestPost,onRequestGet} from "../functions/api/kalshi-collector-internal.js";
const at=new Date("2026-10-20T12:00:00.000Z");
const PREFIX="kalshi/public-shadow/v1/";
function bucket(){const values=new Map();return{
 values,async get(k){return values.has(k)?{json:async()=>JSON.parse(values.get(k))}:null;},
 async put(k,v){values.set(k,String(v));},
};}
async function config(){
 const keys=await webcrypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]);
 const der=Buffer.from(await webcrypto.subtle.exportKey("pkcs8",keys.privateKey));
 return {ARCHIVE:bucket(),KALSHI_API_KEY_ID:"test-id",
   KALSHI_PRIVATE_KEY_PEM1:"-----BEGIN PRIVATE KEY-----\n"+der.toString("base64")+"\n-----END PRIVATE KEY-----",
   FBIS_KALSHI_RELAY_TOKEN:"Z".repeat(64)};
}
function market(sport){
 const series=sport==="nfl"?"KXNFLGAME":"KXNCAAFGAME";
 return {ticker:series+"-26OCT25-ABC",event_ticker:series+"-26OCT25",
   yes_bid_dollars:"0.45",yes_ask_dollars:"0.50",
   yes_ask_size_fp:"14.00",last_price_dollars:"0.47",status:"open"};
}
test("signed Pages market collection yields R2 shadow row, never a wager",async()=>{
 const env=await config(),requests=[];
 const r=await captureSignedKalshiMarkets(env,{sport:"nfl",now:at,webCrypto:webcrypto,
  fetchImpl:async(url,init)=>{
   requests.push({url,init});
   assert.equal(new URL(url).pathname,"/trade-api/v2/markets");
   assert.equal(new URL(url).searchParams.get("series_ticker"),"KXNFLGAME");
   assert.equal(init.method,"GET");
   assert.equal(init.redirect,"manual");
   assert.equal(init.headers["KALSHI-ACCESS-KEY"],"test-id");
   assert.ok(init.headers["KALSHI-ACCESS-SIGNATURE"]);
   return Response.json({markets:[market("nfl")],cursor:""});
  }});
 assert.equal(r.ok,true);
 assert.equal(r.status,"CAPTURED");
 assert.equal(r.authenticationMode,"SIGNED_PAGES");
 assert.equal(requests.length,1);
 const snapshot=JSON.parse(env.ARCHIVE.values.get(PREFIX+"sports/nfl.json"));
 assert.equal(snapshot.records.length,1);
 assert.equal(snapshot.records[0].yesBidDollars,0.45);
 assert.equal(snapshot.records[0].executionEligible,false);
 assert.equal(snapshot.records[0].canonicalEventId,null);
 assert.equal(snapshot.governance.canQualify,false);
 assert.ok(!JSON.stringify(snapshot).includes(env.KALSHI_PRIVATE_KEY_PEM1));
 assert.ok(!JSON.stringify(snapshot).includes("KALSHI-ACCESS-SIGNATURE"));
 const status=JSON.parse(env.ARCHIVE.values.get(PREFIX+"collector-status.json"));
 assert.equal(status.authenticationMode,"SIGNED_PAGES");
 assert.equal(status.paginationComplete,true);
});
test("signed 429 causes one-hour cooldown and no retried source calls",async()=>{
 const env=await config();let calls=0;
 const r=await captureSignedKalshiMarkets(env,{sport:"cfb",now:at,webCrypto:webcrypto,
   fetchImpl:async()=>{calls++;return new Response("",{status:429});}});
 assert.equal(r.ok,false);
 assert.equal(r.status,"RATE_LIMITED");
 assert.equal(r.httpStatus,429);
 assert.ok(Date.parse(r.blockedUntil)-at.getTime()>=3600000);
 const second=await captureSignedKalshiMarkets(env,{sport:"nfl",
   now:new Date(at.getTime()+16*60000),webCrypto:webcrypto,
   fetchImpl:async()=>{calls++;throw Error("NO_SECOND_FETCH");}});
 assert.equal(second.code,"KALSHI_SIGNED_COOLDOWN");
 assert.equal(calls,1);
});
test("recent signed market capture allows the other sport while throttling the same sport",async()=>{
 const env=await config();let calls=0;
 await captureSignedKalshiMarkets(env,{sport:"nfl",now:at,webCrypto:webcrypto,
  fetchImpl:async()=>{calls++;return Response.json({markets:[],cursor:""});}});
 const next=await captureSignedKalshiMarkets(env,{sport:"cfb",webCrypto:webcrypto,
  now:new Date(at.getTime()+3*60000),
  fetchImpl:async()=>{calls++;return Response.json({markets:[],cursor:""});}});
 assert.equal(next.status,"CAPTURED");
 assert.equal(calls,2);
 const repeat=await captureSignedKalshiMarkets(env,{sport:"cfb",webCrypto:webcrypto,
  now:new Date(at.getTime()+4*60000),fetchImpl:async()=>{calls++;throw Error("NO_THIRD_FETCH");}});
 assert.equal(repeat.code,"KALSHI_SIGNED_POLL_NOT_DUE");
 assert.equal(calls,2);
});
test("Pages internal route rejects absent and wrong token before signing",async()=>{
 const env=await config(),url="https://fbis.test/api/kalshi-collector-internal?scope=markets&sport=nfl";
 let calls=0;
 for(const token of [null,"bad"]){
  const request=new Request(url,{method:"POST",headers:token?{"x-fbis-kalshi-relay-token":token}:{}});
  const r=await onRequestPost({request,env,webCrypto:webcrypto,
    fetchImpl:async()=>{calls++;throw Error("NO_NETWORK");}});
  assert.equal(r.status,403);
  assert.equal((await r.json()).code,"INTERNAL_COLLECTOR_ACCESS_DENIED");
 }
 assert.equal(calls,0);
 assert.equal((await onRequestGet()).status,405);
});
test("authorized Pages endpoint only accepts limited GET-only sports scope",async()=>{
 const env=await config(),token=env.FBIS_KALSHI_RELAY_TOKEN;
 const request=new Request("https://fbis.test/api/kalshi-collector-internal?scope=markets&sport=cfb",{
  method:"POST",headers:{"x-fbis-kalshi-relay-token":token},
 });
 let calls=0;
 const r=await onRequestPost({request,env,webCrypto:webcrypto,
  fetchImpl:async(_url,init)=>{
   calls++;
   assert.equal(init.method,"GET");
   return Response.json({markets:[market("cfb")],cursor:""});
  }});
 assert.equal(r.status,200);
 assert.equal((await r.json()).status,"CAPTURED");
 assert.equal(calls,1);
 const bad=await onRequestPost({
   request:new Request("https://fbis.test/api/kalshi-collector-internal?scope=orders",{
    method:"POST",headers:{"x-fbis-kalshi-relay-token":token},
   }),env,webCrypto:webcrypto,
   fetchImpl:async()=>{throw Error("NO");},
 });
 assert.equal(bad.status,400);
 const proxy=kalshiSignedReadProxy(env,{webCrypto:webcrypto,fetchImpl:async()=>{
  throw Error("NO_EXTERNAL_FETCH");}});
 await assert.rejects(()=>proxy("https://attacker.example/trade-api/v2/markets",{method:"GET"}));
 await assert.rejects(()=>proxy("https://external-api.kalshi.com/trade-api/v2/portfolio/balance",{method:"GET"}));
 await assert.rejects(()=>proxy("https://external-api.kalshi.com/trade-api/v2/markets",{method:"POST"}));
});
test("signed exchange status uses service secret with private Pages signing only",async()=>{
 const env=await config();
 const result=await captureSignedKalshiExchangeStatus(env,{now:at,webCrypto:webcrypto,
  fetchImpl:async(url,init)=>{
   assert.equal(new URL(url).pathname,"/trade-api/v2/exchange/status");
   assert.equal(init.method,"GET");
   assert.ok(init.headers["KALSHI-ACCESS-SIGNATURE"]);
   return Response.json({exchange_active:true,trading_active:false});
  }});
 assert.equal(result.ok,true);
 const saved=JSON.parse(env.ARCHIVE.values.get(PREFIX+"exchange-status.json"));
 assert.equal(saved.exchange.tradingActive,false);
 assert.equal(saved.authenticationMode,"SIGNED_PAGES");
 assert.equal(saved.canAuthorizeWager,false);
});
