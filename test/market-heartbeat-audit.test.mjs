import test from "node:test";
import assert from "node:assert/strict";
import {evaluateMarketHeartbeat} from "../scripts/lib/marketHeartbeatAudit.mjs";
const now=Date.parse("2026-10-14T03:00:00Z");
const iso=m=>new Date(now-m*60000).toISOString();
function fixture(){
  const boards=Array.from({length:12},(_,i)=>({kind:"board",sportId:Math.floor(i/2)+1,feed:i%2?"live":"prematch",reconciled:true,collectedAt:iso(45)}));
  return {pinnodds:{ok:true,results:boards},polymarket:{ok:true,sports:[{sport:"nhl",lastCapture:iso(30)}],signedMarketWebsocket:{operational:true,lastBboCapture:iso(2)}},
    stream:{ok:true,connected:true,operational:true,lastMessageAt:iso(1),lastHeartbeatAt:iso(1),lastError:null}};
}
test("connected stream and reconciled boards pass without provider calls",()=>{
 const x=evaluateMarketHeartbeat({...fixture(),now});
 assert.equal(x.ok,true);assert.equal(x.paidProviderCalls,0);assert.equal(x.pinnodds.freshFullBoardScopes,12);
});
test("completed job is not healthy when it created no recent full-board snapshots",()=>{
 const x=fixture();x.pinnodds.results=x.pinnodds.results.map(s=>({...s,collectedAt:iso(500)}));
 const out=evaluateMarketHeartbeat({...x,now});assert.equal(out.ok,false);assert.ok(out.failures.includes("PINNODDS_NO_RECENT_FULL_BOARD_8H"));
});
test("WebSocket connection failure fails even when old BBO records exist",()=>{
 const x=fixture();x.stream.operational=false;x.stream.connected=false;x.polymarket.signedMarketWebsocket.lastBboCapture=iso(30);
 assert.ok(evaluateMarketHeartbeat({...x,now}).failures.includes("POLYMARKET_WEBSOCKET_NOT_OPERATIONAL"));
});
test("no active contracts is reported as idle, not a fabricated live connection",()=>{
 const x=fixture();x.stream.connected=false;x.stream.operational=false;x.stream.lastError="no-active-markets";
 const out=evaluateMarketHeartbeat({...x,now});assert.equal(out.ok,true);assert.equal(out.websocket.idleNoActiveMarkets,true);assert.equal(out.websocket.operational,false);
});
test("missing public health is blocked without assuming the feed is healthy",()=>{
 const x=fixture();x.stream={ok:false};assert.equal(evaluateMarketHeartbeat({...x,now}).ok,false);
});
