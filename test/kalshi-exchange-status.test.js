import test from "node:test";
import assert from "node:assert/strict";
import {
  KALSHI_EXCHANGE_STATUS_URL, fetchKalshiExchangeStatus, normalizeKalshiExchangeStatus,
} from "../functions/lib/kalshiExchangeStatus.js";
import { collectKalshiExchangeStatusOnce } from "../services/kalshi-public-collector/index.js";
import { kalshiIntegrationHealth } from "../functions/api/kalshi-integration-health.js";

const at = new Date("2026-10-20T11:00:00.000Z");
const prefix = "kalshi/public-shadow/v1/";
function bucket(){
  const data=new Map();
  return {
    data,
    async get(key){return data.has(key)?{json:async()=>JSON.parse(data.get(key))}:null;},
    async put(key,value){data.set(key,String(value));},
  };
}
const status = {
  exchange_active:true,trading_active:true,intra_exchange_transfers_active:false,
  exchange_estimated_resume_time:null,
  exchange_index_statuses:[
    {exchange_index:0,description:"Default",exchange_active:true,
      trading_active:true,intra_exchange_transfers_active:false},
  ],
};

test("documented exchange response is normalized with required booleans",async()=>{
  let calls=0;
  const result=await fetchKalshiExchangeStatus({now:at,fetchImpl:async(url,options)=>{
    calls++;
    assert.equal(url,KALSHI_EXCHANGE_STATUS_URL);
    assert.equal(options.method,"GET");
    assert.equal(options.headers.accept,"application/json");
    assert.equal(options.headers["KALSHI-ACCESS-KEY"],undefined);
    return Response.json(status);
  }});
  assert.equal(calls,1);
  assert.equal(result.ok,true);
  assert.equal(result.status.tradingActive,true);
  assert.equal(result.status.exchangeActive,true);
  assert.equal(result.status.transfersActive,false);
  assert.equal(result.status.exchangeIndices[0].index,0);
  assert.equal(result.status.observedAt,at.toISOString());
  assert.equal(result.status.canAuthorizeWager,false);
  assert.equal(result.status.executionEligible,false);
});

test("missing required booleans and malformed data fail closed",()=>{
  assert.equal(normalizeKalshiExchangeStatus({exchange_active:true}),null);
  assert.equal(normalizeKalshiExchangeStatus({exchange_active:true,trading_active:"true"}),null);
  assert.equal(normalizeKalshiExchangeStatus([]),null);
  const normalized=normalizeKalshiExchangeStatus({
    exchange_active:false,trading_active:false,
    exchange_estimated_resume_time:"not-date",
    exchange_index_statuses:[{exchange_index:-2,exchange_active:true,trading_active:true}],
  });
  assert.equal(normalized.estimatedResumeAt,null);
  assert.equal(normalized.exchangeIndices.length,0);
  assert.equal(normalized.exchangeActive,false);
});

test("status 429 is independent from exchange-open or market-data validity",async()=>{
  const limited=await fetchKalshiExchangeStatus({fetchImpl:async()=>
    new Response("do not echo",{status:429,headers:{"retry-after":"120"}})});
  assert.equal(limited.ok,false);
  assert.equal(limited.code,"KALSHI_STATUS_RATE_LIMITED");
  assert.equal(limited.httpStatus,429);
  assert.equal(limited.retryAfterSeconds,120);
  assert.ok(!JSON.stringify(limited).includes("do not echo"));
  const error=await fetchKalshiExchangeStatus({fetchImpl:async()=>
    new Response("unavailable",{status:503})});
  assert.equal(error.code,"KALSHI_STATUS_HTTP_ERROR");
  assert.equal(error.httpStatus,503);
});

test("single R2 receipt, hourly poll budget, no API request from status health",async()=>{
  const ARCHIVE=bucket();
  let calls=0;
  const fetchImpl=async()=>{calls++;return Response.json(status);};
  const one=await collectKalshiExchangeStatusOnce({ARCHIVE},{now:at,fetchImpl});
  assert.equal(one.ok,true);
  assert.equal(one.state,"VERIFIED");
  assert.equal(calls,1);
  assert.equal(ARCHIVE.data.size,1);
  const again=await collectKalshiExchangeStatusOnce({ARCHIVE},
    {now:new Date(at.getTime()+15*60*1000),fetchImpl});
  assert.equal(again.code,"KALSHI_STATUS_POLL_NOT_DUE");
  assert.equal(calls,1);
  const live=await kalshiIntegrationHealth({ARCHIVE},{now:new Date(at.getTime()+15*60*1000)});
  assert.equal(live.exchangeStatus.state,"RECENT_PROVIDER_REPORT");
  assert.equal(live.exchangeStatus.tradingActive,true);
  assert.equal(live.collector.state,"NOT_STARTED");
  assert.equal(live.stages.publicCollector,"UNVERIFIED");
  assert.equal(live.governance.canAuthorizeWager,false);
});

test("stale exchange status cannot remain presented as current trading permission",async()=>{
  const ARCHIVE=bucket();
  await collectKalshiExchangeStatusOnce({ARCHIVE},{now:at,
    fetchImpl:async()=>Response.json(status)});
  const old=await kalshiIntegrationHealth({ARCHIVE},
    {now:new Date(at.getTime()+90*60*1000)});
  assert.equal(old.exchangeStatus.state,"STALE_PROVIDER_REPORT");
  assert.equal(old.exchangeStatus.tradingActive,null);
  assert.equal(old.exchangeStatus.exchangeActive,null);
  assert.equal(old.exchangeStatus.canAuthorizeWager,false);
});

test("exchange-status provider 429 is stored once with backoff and no open flag",async()=>{
  const ARCHIVE=bucket();
  let calls=0;
  const fail=async()=>{calls++;return new Response("429",{status:429,headers:{"retry-after":"3600"}});};
  const first=await collectKalshiExchangeStatusOnce({ARCHIVE},{now:at,fetchImpl:fail});
  assert.equal(first.state,"RATE_LIMITED");
  assert.equal(first.exchange,null);
  assert.equal(first.httpStatus,429);
  const second=await collectKalshiExchangeStatusOnce({ARCHIVE},
    {now:new Date(at.getTime()+45*60*1000),fetchImpl:fail});
  assert.equal(second.code,"KALSHI_STATUS_POLL_NOT_DUE");
  assert.equal(calls,1);
  const health=await kalshiIntegrationHealth({ARCHIVE},{now:at});
  assert.equal(health.exchangeStatus.state,"RATE_LIMITED");
  assert.equal(health.exchangeStatus.tradingActive,null);
  assert.equal(health.exchangeStatus.upstreamHttpStatus,429);
  assert.equal(health.governance.canChangeCORE,false);
});

test("market-data collector 429 is distinct from exchange active report",async()=>{
  const ARCHIVE=bucket();
  await collectKalshiExchangeStatusOnce({ARCHIVE},{now:at,
    fetchImpl:async()=>Response.json(status)});
  ARCHIVE.data.set(prefix+"collector-status.json",JSON.stringify({
    status:"RATE_LIMITED",httpStatus:429,attemptedAt:at.toISOString(),
    blockedUntil:new Date(at.getTime()+60*60*1000).toISOString(),
  }));
  const health=await kalshiIntegrationHealth({ARCHIVE},{now:at});
  assert.equal(health.exchangeStatus.tradingActive,true);
  assert.equal(health.collector.state,"RATE_LIMITED");
  assert.equal(health.collector.upstreamHttpStatus,429);
  assert.equal(health.stages.publicCollector,"UNVERIFIED");
  assert.equal(health.governance.canQualify,false);
});
