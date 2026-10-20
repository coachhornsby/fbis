import test from "node:test";
import assert from "node:assert/strict";
import {
 KALSHI_EXCHANGE_STATUS_URL,fetchKalshiExchangeStatus,normalizeKalshiExchangeStatus,
} from "../functions/lib/kalshiExchangeStatus.js";
import {collectKalshiExchangeStatusOnce} from "../services/kalshi-public-collector/index.js";
import {kalshiIntegrationHealth} from "../functions/api/kalshi-integration-health.js";
const at=new Date("2026-10-20T11:00:00Z");
const PREFIX="kalshi/public-shadow/v1/";
const key="S".repeat(64);
function bucket(){const m=new Map();return {
  m,async get(k){return m.has(k)?{json:async()=>JSON.parse(m.get(k))}:null;},
  async put(k,v){m.set(k,String(v));},
};}
const status={exchange_active:true,trading_active:true,intra_exchange_transfers_active:false,
  exchange_estimated_resume_time:null,exchange_index_statuses:[{
   exchange_index:0,description:"Default",exchange_active:true,trading_active:true,
  }]};
test("strict exchange status shape is read-only",async()=>{
 const r=await fetchKalshiExchangeStatus({now:at,fetchImpl:async(url,options)=>{
  assert.equal(url,KALSHI_EXCHANGE_STATUS_URL);
  assert.equal(options.method,"GET");
  return Response.json(status);
 }});
 assert.equal(r.ok,true);
 assert.equal(r.status.tradingActive,true);
 assert.equal(r.status.transfersActive,false);
 assert.equal(r.status.canAuthorizeWager,false);
 assert.equal(normalizeKalshiExchangeStatus({exchange_active:true}),null);
 assert.equal(normalizeKalshiExchangeStatus({exchange_active:true,trading_active:"true"}),null);
});
test("strict exchange parser and 429 never imply healthy exchange",async()=>{
 const r=await fetchKalshiExchangeStatus({fetchImpl:async()=>new Response("",{status:429})});
 assert.equal(r.ok,false);
 assert.equal(r.code,"KALSHI_STATUS_RATE_LIMITED");
 assert.equal(r.rateLimited,true);
 assert.equal(normalizeKalshiExchangeStatus([]),null);
});
test("hourly signed status relay calls Pages, never anonymous Kalshi",async()=>{
 const ARCHIVE=bucket();let calls=0;
 const fetchImpl=async(url,options)=>{
  calls++;assert.equal(new URL(url).origin,"https://fbis-myz.pages.dev");
  assert.equal(new URL(url).searchParams.get("scope"),"exchange-status");
  assert.equal(options.headers["x-fbis-kalshi-relay-token"],key);
  return Response.json({ok:true,state:"VERIFIED"});
 };
 const env={ARCHIVE,FBIS_KALSHI_RELAY_TOKEN:key};
 const first=await collectKalshiExchangeStatusOnce(env,{now:at,fetchImpl});
 assert.equal(first.ok,true);
 assert.equal(calls,1);
 ARCHIVE.m.set(PREFIX+"exchange-status.json",JSON.stringify({
  authenticationMode:"SIGNED_PAGES",state:"VERIFIED",observedAt:at.toISOString(),
  nextAllowedAt:new Date(at.getTime()+3600000).toISOString(),exchange:{
   exchangeActive:true,tradingActive:true,transfersActive:false,exchangeIndices:[],
  },
 }));
 const second=await collectKalshiExchangeStatusOnce(env,{
  now:new Date(at.getTime()+900000),
  fetchImpl:async()=>{calls++;throw Error("NO_SECOND_REQUEST");},
 });
 assert.equal(second.code,"KALSHI_STATUS_POLL_NOT_DUE");
 assert.equal(calls,1);
 const h=await kalshiIntegrationHealth({ARCHIVE},{
  now:new Date(at.getTime()+15*60*1000)});
 assert.equal(h.exchangeStatus.tradingActive,true);
 assert.equal(h.stages.publicCollector,"UNVERIFIED");
 assert.equal(h.governance.canAuthorizeWager,false);
});
test("missing service secret blocks hourly status call without public fallback",async()=>{
 let calls=0;
 const r=await collectKalshiExchangeStatusOnce({ARCHIVE:bucket()},{
  now:at,fetchImpl:async()=>{calls++;throw Error("NO");},
 });
 assert.equal(r.code,"SIGNED_RELAY_SECRET_MISSING");
 assert.equal(calls,0);
});
test("stale signed exchange receipt never reports current trading availability",async()=>{
 const ARCHIVE=bucket();
 ARCHIVE.m.set(PREFIX+"exchange-status.json",JSON.stringify({
  authenticationMode:"SIGNED_PAGES",state:"VERIFIED",observedAt:at.toISOString(),
  exchange:{exchangeActive:true,tradingActive:true,transfersActive:true},
 }));
 const h=await kalshiIntegrationHealth({ARCHIVE},{now:new Date(at.getTime()+90*60*1000)});
 assert.equal(h.exchangeStatus.state,"STALE_PROVIDER_REPORT");
 assert.equal(h.exchangeStatus.tradingActive,null);
 assert.equal(h.governance.canQualify,false);
});
test("provider market 429 remains separate from verified signed exchange report",async()=>{
 const ARCHIVE=bucket();
 ARCHIVE.m.set(PREFIX+"exchange-status.json",JSON.stringify({
  authenticationMode:"SIGNED_PAGES",state:"VERIFIED",observedAt:at.toISOString(),
  exchange:{exchangeActive:true,tradingActive:true,transfersActive:false,exchangeIndices:[]},
 }));
 ARCHIVE.m.set(PREFIX+"collector-status.json",JSON.stringify({
  authenticationMode:"SIGNED_PAGES",status:"RATE_LIMITED",httpStatus:429,
  attemptedAt:at.toISOString(),blockedUntil:new Date(at.getTime()+3600000).toISOString(),
 }));
 const h=await kalshiIntegrationHealth({ARCHIVE},{now:at});
 assert.equal(h.collector.upstreamHttpStatus,429);
 assert.equal(h.exchangeStatus.tradingActive,true);
 assert.equal(h.governance.canQualify,false);
});
