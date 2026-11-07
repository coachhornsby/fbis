import {CERTIFIED_EXECUTION_JOBS} from '../services/account-budget/executionJobs.mjs';
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
 return {CLOUDFLARE_ACCOUNT_ID:'test',FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async({job})=>({allowed:true,expiresAtMs:Date.now()+60000,maxUnits:CERTIFIED_EXECUTION_JOBS[job].units})})},ARCHIVE:bucket(),KALSHI_API_KEY_ID:"test-id",
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
 assert.equal(bad.status,503);
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

test('CFB partial pages fit existing capture lease and retain per-row times',async()=>{
 const {beginJobExecution}=await import('../services/account-budget/jobScope.mjs');
 const {KALSHI_CAPTURE_JOB}=await import('../services/account-budget/executionJobs.mjs');
 const original=await config();let writes=0,requests=0,bytes=0,reads=0;
 original.ARCHIVE.head=async key=>original.ARCHIVE.values.has(key)?{size:Buffer.byteLength(original.ARCHIVE.values.get(key))}:null;
 original.ARCHIVE.get=async key=>{reads++;const text=original.ARCHIVE.values.get(key);return text===undefined?null:{size:Buffer.byteLength(text),body:new Response(text).body};};
 const put=original.ARCHIVE.put;original.ARCHIVE.put=async(k,v)=>{writes++;bytes+=Buffer.byteLength(v);return put(k,v);};
 const pages=[{markets:[market('cfb')],cursor:'next-page'},{markets:[{...market('cfb'),ticker:'KXNCAAFGAME-26OCT25-DEF'}],cursor:''}];
 async function cycle(now){
  const fetchImpl=async()=>{requests++;return Response.json(pages.shift());};
  const env=await beginJobExecution(original,KALSHI_CAPTURE_JOB,{fetchImpl,network:{origin:'https://external-api.kalshi.com',path:'/trade-api/v2/markets'}});
  const result=await captureSignedKalshiMarkets(env,{sport:'cfb',now,webCrypto:webcrypto,fetchImpl:env.FBIS_JOB_FETCH});
  await assert.rejects(()=>env.ARCHIVE.put('unbudgeted-fifth-write','{}'),/JOB_UNIT_LIMIT_r2Writes/);
  return result;
 }
 const first=await cycle(at);assert.equal(first.status,'PAGINATING');assert.equal(requests,1);assert.equal(writes,4);
 const partial=JSON.parse(original.ARCHIVE.values.get(PREFIX+'sports/cfb.json'));
 assert.equal(partial.paginationComplete,false);assert.equal(partial.coverage,'BOUNDED_PARTIAL_SERIES');assert.equal(partial.canAuthorizeWager,false);assert.equal(partial.records[0].fetchedAt,at.toISOString());
 const later=new Date(at.getTime()+20*60000),second=await cycle(later);assert.equal(second.status,'CAPTURED');assert.equal(requests,2);assert.equal(writes,8);assert.equal(reads,6);
 const full=JSON.parse(original.ARCHIVE.values.get(PREFIX+'sports/cfb.json'));assert.equal(full.paginationComplete,true);assert.equal(full.records[0].fetchedAt,at.toISOString());assert.equal(full.records[1].fetchedAt,later.toISOString());assert.equal(full.oldestMarketFetchedAt,at.toISOString());
 assert.ok(bytes<8388608);assert.equal(CERTIFIED_EXECUTION_JOBS[KALSHI_CAPTURE_JOB].units.r2Writes,4);assert.equal(CERTIFIED_EXECUTION_JOBS[KALSHI_CAPTURE_JOB].units.requests,1);
});
