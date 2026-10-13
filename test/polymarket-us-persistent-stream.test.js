import test from "node:test";
import assert from "node:assert/strict";
import {STREAM_SPORTS,fairMarketSelection,shouldSaveBbo,liveBboOffer,parseStreamControl,streamIsHealthy,fetchStreamUpgrade} from "../services/polymarket-us-stream/core.mjs";
test("persistent market selection distributes subscriptions over all supported sports",()=>{
 const rows=STREAM_SPORTS.flatMap(s=>Array.from({length:5},(_,i)=>({
   sport:s,source_market_id:s+"-"+i,canonical_event_id:s+"-game"
 })));
 const selected=fairMarketSelection(rows,{perSport:4,maxMarkets:44});
 assert.equal(selected.length,44);
 assert.equal(new Set(selected.map(x=>x.sport)).size,11);
 assert.equal(new Set(selected.map(x=>x.source_market_id)).size,44);
});
test("stream avoids storms but captures meaningful price movements",()=>{
 const a={marketSlug:"nfl-buf",bestBid:0.55,bestAsk:0.56,timeMs:1000};
 assert.equal(shouldSaveBbo(a,null),true);
 assert.equal(shouldSaveBbo({...a,timeMs:4000},{...a,timeMs:1000}),false);
 assert.equal(shouldSaveBbo({...a,bestAsk:0.57,timeMs:4000},{...a,timeMs:1000}),true);
 assert.equal(shouldSaveBbo({...a,timeMs:11500},{...a,timeMs:1000}),true);
 assert.equal(shouldSaveBbo({...a,bestAsk:null,bestBid:null},null),false);
});
test("all live evidence stays nonexecuting with precise source and bid/ask",()=>{
 const base={sport:"nhl",league:"nhl",canonical_event_id:"game123",
 event_start_time:"2026-10-13T22:00:00Z",home_team:"Home",
 away_team:"Away",market_family:"moneyline",side:"Home",
 source_outcome_id:"outcome1",provider_event_id:"provider"};
 const t={marketSlug:"nhl-home",bestBid:0.48,bestAsk:0.51,
   lastTrade:0.50,bidDepth:120,askDepth:100,at:"2026-10-13T20:00:00Z"};
 const o=liveBboOffer(t,base);
 assert.equal(o.executionEligible,false);
 assert.equal(o.canAuthorizeWager,false);
 assert.equal(o.contractPrice,0.51);
 assert.equal(o.raw.bestBid,0.48);
 assert.equal(o.raw.bestAsk,0.51);
 assert.equal(o.raw.sourceObservedAt,null);
});

test("stream health requires a connected socket and a recent message",()=>{
 assert.equal(streamIsHealthy({connected:false,lastMessageAt:1000,now:2000}),false);
 assert.equal(streamIsHealthy({connected:true,lastMessageAt:0,now:2000}),false);
 assert.equal(streamIsHealthy({connected:true,lastMessageAt:1000,now:122000}),false);
 assert.equal(streamIsHealthy({connected:true,lastMessageAt:3000,now:2000}),false);
 assert.equal(streamIsHealthy({connected:true,lastMessageAt:1000,now:2000}),true);
});
test("heartbeat and subscription errors remain control frames",()=>{
 assert.deepEqual(parseStreamControl('{"heartbeat":{}}'),{type:"heartbeat"});
 assert.deepEqual(parseStreamControl({error:"failure",request_id:"abc"}),{type:"error"});
 assert.equal(parseStreamControl('{'),null);
 assert.equal(parseStreamControl({marketDataLite:{marketSlug:"nhl-home"}}),null);
});

test("handshake deadline is cleared on upgrade and cannot abort a live connection",async()=>{
 let signal,cleared=false,callback;
 const response=await fetchStreamUpgrade('https://provider.test/ws',{headers:{Upgrade:'websocket'}},{fetchImpl:async(url,options)=>{signal=options.signal;return{status:101}},timers:{setTimeout(fn){callback=fn;return 1},clearTimeout(id){assert.equal(id,1);cleared=true;callback=null;}}});
 assert.equal(response.status,101);assert.equal(cleared,true);assert.equal(callback,null);assert.equal(signal.aborted,false);
});
