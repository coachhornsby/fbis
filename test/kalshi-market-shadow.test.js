import test from "node:test";
import assert from "node:assert/strict";
import {
  KALSHI_SHADOW_AUTHORITY,kalshiShadowAuthority,normalizeKalshiShadowMarket,
  normalizeKalshiShadowOrderbook,getKalshiShadowMarkets,getKalshiShadowBook,
} from "../functions/lib/kalshiMarketShadow.js";
import { onRequestGet,onRequestPost } from "../functions/api/kalshi-market-shadow.js";

const now = new Date("2026-10-20T08:00:00Z");
const market = {
  ticker:"KXNFLGAME-26OCT25-DAL",
  event_ticker:"KXNFLGAME-26OCT25",
  status:"active",
  market_type:"binary",
  title:"Dallas wins",
  yes_sub_title:"Dallas",
  no_sub_title:"Not Dallas",
  yes_bid_dollars:"0.5200",
  yes_ask_dollars:"0.5400",
  no_bid_dollars:"0.4600",
  no_ask_dollars:"0.4800",
  yes_bid_size_fp:"320.00",
  yes_ask_size_fp:"210.00",
  volume_fp:"800.0",
  open_interest_fp:"400.0",
  last_price_dollars:"0.5300",
  updated_time:"2026-10-20T07:45:00Z",
  close_time:"2026-10-25T21:00:00Z",
  rules_primary:"Win is based on official final game result.",
};
const mock = async (url,options)=>{
  assert.equal(options.method,"GET");
  assert.equal(new URL(url).origin,"https://external-api.kalshi.com");
  const u=new URL(url);
  if(u.pathname.endsWith("/orderbook")) return Response.json({orderbook_fp:{
    yes_dollars:[["0.48","50.00"],["0.52","100.00"]],
    no_dollars:[["0.44","200.00"],["0.46","210.00"]],
  }});
  if(u.pathname.endsWith("/markets")) return Response.json({markets:[market],cursor:"page-two"});
  if(u.pathname.endsWith(market.ticker)) return Response.json({market});
  throw Error("unhandled path");
};

test("shadow authority cannot be elevated by request flags or environment",()=>{
  for(const mode of ["production","execution","authoritative","live",undefined]){
    const auth=kalshiShadowAuthority({mode,KALSHI_MARKET_MODE:"authoritative",canTrade:true});
    assert.equal(auth.mode,KALSHI_SHADOW_AUTHORITY);
    assert.equal(auth.canPublish,false);
    assert.equal(auth.canChangeProjection,false);
    assert.equal(auth.canQualify,false);
    assert.equal(auth.canWriteMarketHistory,false);
    assert.equal(auth.canAuthorizeWager,false);
    assert.equal(auth.executionEligible,false);
  }
});

test("price normalization keeps dollar decimals and legacy CENTS separate",()=>{
  const latest=normalizeKalshiShadowMarket(market,{sport:"nfl",fetchedAt:now.toISOString()});
  assert.equal(latest.yesBidDollars,0.52);
  assert.equal(latest.yesAskDollars,0.54);
  assert.equal(latest.noBidDollars,0.46);
  assert.equal(latest.yesBidSize,320);
  assert.equal(latest.marketMetadataUpdatedAt,"2026-10-20T07:45:00.000Z");
  assert.equal(latest.quoteSourceTime,null);
  assert.equal(latest.matchStatus,"UNMATCHED");
  assert.equal(latest.canonicalEventId,null);
  assert.equal(latest.impliedEdge,null);
  assert.equal(latest.executionEligible,false);
  const legacy=normalizeKalshiShadowMarket({...market,
    yes_bid_dollars:null,yes_ask_dollars:null,no_bid_dollars:null,last_price_dollars:null,
    yes_bid:52,yes_ask:54,no_bid:46,last_price:53,
  },{sport:"nfl"});
  assert.equal(legacy.yesBidDollars,0.52);
  assert.equal(legacy.yesAskDollars,0.54);
  assert.equal(legacy.lastTradeDollars,0.53);
  const malformed=normalizeKalshiShadowMarket({...market,yes_bid_dollars:"52.00"},{sport:"nfl"});
  assert.equal(malformed.yesBidDollars,null);
  assert.equal(normalizeKalshiShadowMarket({...market,ticker:"KXNCAAFGAME-EX"},{sport:"nfl"}),null);
});

test("orderbook derives YES ask from highest NO bid and NO ask from highest YES bid",()=>{
  const orderbook=normalizeKalshiShadowOrderbook({orderbook_fp:{
    yes_dollars:[["0.15","1"],["0.52","100"],["0.47","5"]],
    no_dollars:[["0.46","210"],["0.20","7"]],
  }});
  assert.equal(orderbook.yesAskDollars,0.54);
  assert.equal(orderbook.noAskDollars,0.48);
  assert.equal(orderbook.yesAskSizeContracts,210);
  assert.equal(orderbook.noAskSizeContracts,100);
  assert.equal(orderbook.askDerivation,"COMPLEMENTARY_OPPOSITE_BID");
  assert.equal(orderbook.sourceObservedAt,null);
  assert.deepEqual(normalizeKalshiShadowOrderbook({orderbook_fp:{yes_dollars:[],no_dollars:[]}}).yesAskDollars,null);
  assert.equal(normalizeKalshiShadowOrderbook({orderbook_fp:{yes_dollars:[["1.75","9"]],no_dollars:[]}}).yesBids.length,0);
});

test("market list is bounded, exposes incomplete pagination, and never promotes quotes",async()=>{
  const result=await getKalshiShadowMarkets("nfl",{fetchImpl:mock,now});
  assert.equal(result.ok,true);
  assert.equal(result.records.length,1);
  assert.equal(result.nextCursorAvailable,true);
  assert.equal(result.paginationComplete,false);
  assert.equal(result.governance.canPublish,false);
  assert.equal(result.governance.canAuthorizeWager,false);
  assert.equal(result.records[0].marketFamily,"UNVERIFIED");
  assert.equal(result.records[0].feesDollars,null);
});

test("specific market orderbook detail remains informational and unlinked",async()=>{
  const result=await getKalshiShadowBook("nfl",market.ticker,{fetchImpl:mock,now});
  assert.equal(result.ok,true);
  assert.equal(result.market.ticker,market.ticker);
  assert.equal(result.orderbook.yesAskDollars,0.54);
  assert.equal(result.feeScheduleVerified,false);
  assert.equal(result.executableStakeCostVerified,false);
  assert.equal(result.governance.canChangeProjection,false);
  assert.equal(result.market.canonicalEventId,null);
});

test("series allowlisting and ticker validation prohibit arbitrary upstream fetches",async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;throw Error("should not call");};
  const unknown=await getKalshiShadowMarkets("soccer",{fetchImpl});
  const malicious=await getKalshiShadowBook("nfl","https://example.org/private",{fetchImpl});
  const other=await getKalshiShadowBook("nfl","KXNCAAFGAME-26OCT25-ABC",{fetchImpl});
  assert.equal(unknown.ok,false);
  assert.equal(malicious.code,"KALSHI_TICKER_NOT_ALLOWED");
  assert.equal(other.code,"KALSHI_TICKER_NOT_ALLOWED");
  assert.equal(calls,0);
});

test("public API never needs private credentials or env.DB and ignores mode escalation",async()=>{
  const request=new Request("https://fbis.test/api/kalshi-market-shadow?sport=nfl&mode=authoritative");
  const res=await onRequestGet({request,fetchImpl:mock});
  assert.equal(res.status,200);
  assert.match(res.headers.get("cache-control"),/max-age=15/);
  const body=await res.json();
  assert.equal(body.governance.mode,"SHADOW_ONLY");
  assert.equal(body.records[0].executionEligible,false);
  assert.equal(body.records[0].yesAskDollars,0.54);
  const forbidden=await onRequestGet({request:new Request("https://fbis.test/api/kalshi-market-shadow?sport=tennis"),
    fetchImpl:async()=>{throw Error("unexpected fetch");}});
  assert.equal(forbidden.status,400);
  assert.equal((await onRequestPost()).status,405);
});

test("failed sources do not fabricate a quote, stale state or authority",async()=>{
  const fails=async()=>new Response("provider unavailable",{status:503});
  const result=await getKalshiShadowMarkets("nfl",{fetchImpl:fails});
  assert.deepEqual(result,{ok:false,code:"KALSHI_PUBLIC_HTTP_ERROR",httpStatus:503});
  const malformed=await getKalshiShadowBook("nfl",market.ticker,{fetchImpl:async(url)=>{
    if(url.endsWith("/orderbook"))return Response.json({orderbook_fp:{yes_dollars:[]}});
    return Response.json({market:{...market,ticker:"OTHER-MARKET"}});
  }});
  assert.equal(malformed.code,"KALSHI_MARKET_IDENTITY_MISMATCH");
});

test("live provider HTTP 429 is a first-class operational blocker, not a quote",async()=>{
  let calls=0;
  const limited=async()=>{
    calls++;
    return new Response("rate limited",{
      status:429,headers:{"retry-after":"120"},
    });
  };
  const list=await getKalshiShadowMarkets("nfl",{fetchImpl:limited});
  assert.equal(list.ok,false);
  assert.equal(list.code,"KALSHI_PUBLIC_RATE_LIMITED");
  assert.equal(list.httpStatus,429);
  assert.equal(list.rateLimited,true);
  assert.equal(list.retryAfterSeconds,120);
  assert.equal(calls,1); // No speculative exponential retry loop on HTTP request.
  assert.equal(list.records,undefined); // Fail closed: no stale or invented quote.
});
