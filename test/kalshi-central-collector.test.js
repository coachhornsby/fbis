import test from "node:test";
import assert from "node:assert/strict";
import collector,{selectedSport,collectKalshiPublicOnce} from "../services/kalshi-public-collector/index.js";
import {loadKalshiR2Shadow} from "../functions/lib/kalshiR2Shadow.js";
import {onRequestGet} from "../functions/api/kalshi-market-shadow.js";

function archive(){
 const records=new Map();
 return {records,async get(key){const body=records.get(key);return body===undefined?null:{json:async()=>JSON.parse(body)};},
  async put(key,value){records.set(key,String(value));}};
}
function atSport(sport){
 const start=Date.parse("2026-10-20T00:00:00Z");
 for(let i=0;i<100;i++){
  const d=new Date(start+i*15*60*1000);
  if(selectedSport(d)===sport)return d;
 }
 throw Error("sport slot not found");
}
function market(sport){
 const ticker=sport==="nfl"?"KXNFLGAME-26OCT25-NY":"KXNCAAFGAME-26OCT25-NY";
 return {ticker,event_ticker:ticker.split("-").slice(0,2).join("-"),
  yes_bid_dollars:"0.43",yes_ask_dollars:"0.47",last_price_dollars:"0.45"};
}
test("scheduled collector is single-writer R2, writes no account or D1 records",async()=>{
 const bucket=archive(),d=atSport("nfl");
 let calls=0;
 const r=await collectKalshiPublicOnce({ARCHIVE:bucket},{now:d,fetchImpl:async url=>{
  calls++;assert.equal(new URL(url).pathname,"/trade-api/v2/markets");
  return Response.json({markets:[market("nfl")],cursor:""});
 }});
 assert.equal(r.ok,undefined);
 assert.equal(r.status,"CAPTURED");
 assert.equal(calls,1);
 assert.equal(bucket.records.size,2);
 const env={ARCHIVE:bucket,DB:{prepare(){throw Error("MUST_NOT_USE_D1");}}};
 const data=await loadKalshiR2Shadow(env,"nfl",{now:new Date(d.getTime()+10000)});
 assert.equal(data.ok,true);
 assert.equal(data.records.length,1);
 assert.equal(data.records[0].executionEligible,false);
 assert.equal(data.records[0].canonicalEventId,null);
 assert.equal(data.governance.canQualify,false);
 assert.ok(!JSON.stringify(data).includes("KALSHI_PRIVATE_KEY_PEM"));
});
test("production Pages path reads R2 without a Kalshi HTTP call",async()=>{
 const bucket=archive(),d=atSport("nfl");
 await collectKalshiPublicOnce({ARCHIVE:bucket},{now:d,fetchImpl:async()=>Response.json({markets:[market("nfl")],cursor:""})});
 // old timestamp is intentionally stale now: the route must not invent freshness.
 let called=false;
 const response=await onRequestGet({request:new Request("https://fbis.test/api/kalshi-market-shadow?sport=nfl"),
  env:{ARCHIVE:bucket},fetchImpl:async()=>{called=true;throw Error("DO_NOT_CALL_KALSHI_PER_VISITOR");}});
 assert.equal(called,false);
 assert.ok([200,503].includes(response.status));
 if(response.status===200)assert.equal((await response.json()).governance.canQualify,false);
 else assert.equal((await response.json()).code,"KALSHI_SNAPSHOT_STALE");
});
test("central collector 429 records cooldown, next cron skips request",async()=>{
 const bucket=archive(),d=atSport("nfl");
 let calls=0;
 const first=await collectKalshiPublicOnce({ARCHIVE:bucket},{now:d,fetchImpl:async()=>{
  calls++;return new Response("",{status:429,headers:{"retry-after":"120"}});
 }});
 assert.equal(first.status,"RATE_LIMITED");
 assert.ok(Date.parse(first.blockedUntil)-d.getTime()>=3600000);
 const second=await collectKalshiPublicOnce({ARCHIVE:bucket},{now:new Date(d.getTime()+15*60000),fetchImpl:async()=>{calls++;throw Error("NO_RETRY");}});
 assert.equal(second.code,"KALSHI_PUBLIC_COOLDOWN");
 assert.equal(calls,1);
 const status=await collector.fetch(new Request("https://kalshi.test/health"),{ARCHIVE:bucket});
 assert.equal(status.status,200);
 assert.equal((await status.json()).canAuthorizeWager,false);
 const refused=await collector.fetch(new Request("https://kalshi.test/order",{method:"POST"}),{ARCHIVE:bucket});
 assert.equal(refused.status,404);
});
test("forged R2 payload cannot promote quotes or model authority",async()=>{
 const bucket=archive(),d=atSport("nfl"),tick=market("nfl").ticker;
 bucket.records.set("kalshi/public-shadow/v1/sports/nfl.json",JSON.stringify({
  ok:true,seriesTicker:"KXNFLGAME",sport:"nfl",capturedAt:d.toISOString(),
  records:[{ticker:tick,sport:"nfl",canonicalEventId:"sneaky",canQualify:true,
    executionEligible:true,feesDollars:0,impliedEdge:0.91}],
 }));
 const res=await loadKalshiR2Shadow({ARCHIVE:bucket},"nfl",{now:new Date(d.getTime()+1000)});
 assert.equal(res.ok,true);
 assert.equal(res.records[0].canonicalEventId,null);
 assert.equal(res.records[0].executionEligible,false);
 assert.equal(res.records[0].canQualify,false);
 assert.equal(res.records[0].feesDollars,null);
});
