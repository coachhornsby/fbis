import test from "node:test";
import assert from "node:assert/strict";
import {evaluatePulse,runMarketPulse} from "../scripts/core-market-pulse.mjs";
const iso=(ms=0)=>new Date(Date.now()-ms).toISOString();
const pin=()=>({ok:true,results:[
 ...[1,2,3,4,5,6].flatMap(sportId=>["prematch","live"].map(feed=>({
  kind:"board",sportId,feed,status:"RECENT_CAPTURE",collectedAt:iso(3600000),reconciled:true
 }))),
 ...["prematch","live"].map(feed=>({kind:"drops",feed,status:"RECENT_CAPTURE",collectedAt:iso(500000)}))
]});
const poly=()=>({ok:true,signedMarketWebsocket:{connectionStatus:"CONNECTED",operational:true,subscriptions:42,
 lastMessageAt:iso(12000),lastBboCapture:iso(20000),bboRecordsLast24h:123,matchedEventsLast24h:9},
 sports:[{sport:"nhl",lastCapture:iso(3600000),displayedPrices:55,matchedGames:7}]});
function responder(value){return new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}})}
test("healthy feeds require recent 12 PinnOdds board receipts and live Polymarket subscription",()=>{
 const state=evaluatePulse(pin(),poly());
 assert.equal(state.ok,true);assert.equal(state.pinnodds.healthyBoards,12);
 assert.equal(state.polymarket.subscriptions,42);
});
test("scheduled drops success alone cannot prove PinnOdds board currency",()=>{
 const stale=pin();stale.results.filter(x=>x.kind==="board").forEach(x=>x.collectedAt=iso(9*3600000));
 const state=evaluatePulse(stale,poly());
 assert.equal(state.ok,false);assert.equal(state.pinnodds.staleBoards,12);
 assert.ok(state.incidents.includes("PINNODDS_BOARD_STALE_12"));
 assert.equal(state.repairableWebsocket,false);
});
test("monitor attempts only one signed websocket reconnect and never collects PinnOdds",async()=>{
 let calls=[],p=pin(),stale=poly();
 stale.signedMarketWebsocket={...stale.signedMarketWebsocket,operational:false,connectionStatus:"DISCONNECTED",subscriptions:0,lastMessageAt:null};
 const fetchImpl=async(url,opts={})=>{
  calls.push({url,method:opts.method||"GET"});
  if(url.endsWith("/api/pinnodds-status"))return responder(p);
  if(url.endsWith("/api/polymarket-status"))return responder(calls.some(c=>c.method==="POST")?poly():stale);
  if(url.endsWith("/api/polymarket-stream-start"))return responder({ok:true,connected:true});
  throw Error("unexpected request");
 };
 const state=await runMarketPulse({fetchImpl,secret:"test-only",sleep:async()=>{}});
 assert.equal(state.ok,true);assert.equal(state.recovery,"STREAM_RECONNECTED");
 assert.equal(calls.filter(c=>c.method==="POST").length,1);
 assert.ok(calls.every(c=>!c.url.includes("pinnodds-capture")&&!c.url.includes("action")));
 assert.equal(state.paidCollectorLaunched,false);
});
test("stale websocket BBO persistence is a failure, but never triggers repeated reconnect if connected",async()=>{
 let posts=0;const stale=poly();stale.signedMarketWebsocket.lastBboCapture=iso(7*3600000);
 const fetchImpl=async(url,opts={})=>{
  if(opts.method==="POST")posts++;
  return responder(url.endsWith("pinnodds-status")?pin():stale);
 };
 const state=await runMarketPulse({fetchImpl,secret:"test-only"});
 assert.equal(state.ok,false);
 assert.ok(state.incidents.includes("POLYMARKET_WS_BBO_PERSISTENCE_STALE"));
 assert.equal(posts,0);
});
test("no signer secret blocks automatic reconnect without hidden side effects",async()=>{
 let posts=0;const bad=poly();bad.signedMarketWebsocket.connectionStatus="DISCONNECTED";
 const fetchImpl=async(url,opts={})=>{
  if(opts.method==="POST")posts++;
  return responder(url.endsWith("pinnodds-status")?pin():bad);
 };
 const state=await runMarketPulse({fetchImpl,secret:""});
 assert.equal(state.ok,false);assert.equal(state.recovery,"NOT_ATTEMPTED_MISSING_SECRET");
 assert.equal(posts,0);
});

test("upcoming tennis markets with no verified official schedule raise an incident",()=>{
 const p=poly();
 p.tennisCoverage={status:"OFFICIAL_SCHEDULE_MISSING",officialUpcomingMatches:0,
  rest:{providerEvents:3,upcomingObservations:4},websocket:{observations:0}};
 const state=evaluatePulse(pin(),p);
 assert.ok(state.incidents.includes("TENNIS_CANONICAL_FIXTURES_MISSING"));
 assert.ok(state.notes.includes("TENNIS_UPCOMING_REST_WITHOUT_WS"));
 assert.equal(state.repairableWebsocket,false);
});
test("no upcoming tennis market is not a critical outage even with empty official schedule",()=>{
 const p=poly();
 p.tennisCoverage={status:"OFFICIAL_SCHEDULE_MISSING",officialUpcomingMatches:0,
  rest:{providerEvents:0,upcomingObservations:0},websocket:{observations:0}};
 const state=evaluatePulse(pin(),p);
 assert.equal(state.ok,true);
 assert.ok(state.notes.includes("TENNIS_OFFICIAL_SCHEDULE_EMPTY"));
});
