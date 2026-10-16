import test from "node:test";
import assert from "node:assert/strict";
import {STREAM_SPORTS,fairMarketSelection,shouldSaveBbo,liveBboOffer,parseStreamControl,streamIsHealthy,fetchStreamUpgrade,streamContractRosterWindow} from "../services/polymarket-us-stream/core.mjs";
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

test("72h identity-only REST contract roster bootstraps WebSocket after a delayed source harvest",()=>{
 const now=Date.parse("2026-10-14T03:16:00Z");
 const window=streamContractRosterWindow(now);
 assert.equal(window.freshSince,"2026-10-14T02:41:00.000Z");
 assert.equal(window.since,"2026-10-11T03:16:00.000Z");
 assert.ok(Date.parse("2026-10-14T00:54:00Z")>=Date.parse(window.since));
});
test("WebSocket discovery fallback never extends indefinitely",()=>{
 assert.throws(()=>streamContractRosterWindow(NaN),/invalid-roster-clock/);
 const {since,freshSince}=streamContractRosterWindow(Date.parse("2026-10-14T03:16:00Z"));
 assert.equal(Date.parse(freshSince)-Date.parse(since),(72*60-35)*60*1000);
});

test("SQL roster is balanced by sport before subscription cap",async()=>{
 const {readFileSync}=await import("node:fs");
 const worker=readFileSync(new URL("../services/polymarket-us-stream/worker.mjs",import.meta.url),"utf8");
 assert.match(worker,/PARTITION BY sport ORDER BY/);
 assert.match(worker,/WHERE sport_rank<=6/);
 assert.doesNotMatch(worker,/collected_at DESC LIMIT 750/);
});

test("active tennis retains six WS slots inside 48 while other sport groups retain four",()=>{
 const rows=STREAM_SPORTS.flatMap(sport=>Array.from({length:6},(_,i)=>({
  sport,source_market_id:sport+"-contract-"+i,canonical_event_id:null
 })));
 const result=fairMarketSelection(rows,{perSport:6,maxMarkets:48});
 assert.equal(result.length,48);
 assert.equal(result.filter(r=>r.sport==="tennis").length,6);
 for(const sport of STREAM_SPORTS.filter(s=>s!=="tennis")){
  assert.ok(result.filter(r=>r.sport===sport).length>=4,sport+" lost baseline coverage");
 }
 assert.equal(new Set(result.map(r=>r.source_market_id)).size,48);
 const withoutTennis=fairMarketSelection(rows.filter(r=>r.sport!=="tennis"),{perSport:6,maxMarkets:48});
 assert.equal(withoutTennis.length,48);
 assert.equal(withoutTennis.filter(r=>r.sport==="tennis").length,0);
});


test("an outage-aged contract directory cannot refresh REST prices or supply a socket quote clock",async()=>{
 const {marketTemporalStatus}=await import('../functions/lib/marketTemporal.js');
 const now=new Date('2026-10-15T16:30:00Z'),old='2026-10-15T07:19:00Z';
 const window=streamContractRosterWindow(now.getTime());
 assert.ok(Date.parse(old)>=Date.parse(window.since));
 assert.ok(Date.parse('2026-10-11T15:00:00Z')<Date.parse(window.since));
 const base={sport:'soccer',canonical_event_id:'401884770',event_start_time:'2026-10-16T18:30:00Z',period:'full_game',collected_at:old,source_observed_at:old};
 const stale=marketTemporalStatus({source:'Polymarket US',eventId:base.canonical_event_id,collectedAt:old,providerObservedAt:old},{now});
 assert.equal(stale.currentDisplayEligible,false);
 const live=liveBboOffer({marketSlug:'soccer-draw',at:now.toISOString(),sourceObservedAt:'2026-10-15T16:29:59Z',bestAsk:0.27},base);
 assert.equal(live.raw.sourceObservedAt,'2026-10-15T16:29:59Z');
 assert.equal(live.contractPrice,0.27);
 assert.equal(live.executionEligible,false);
 assert.equal(live.canAuthorizeWager,false);
 const noClock=liveBboOffer({marketSlug:'soccer-draw',at:now.toISOString(),bestAsk:0.27},base);
 assert.equal(noClock.raw.sourceObservedAt,null);
});


test("a successful retried socket flush clears only its recovered database error",async()=>{
 const {readFile}=await import('node:fs/promises');
 const file=new URL('../services/polymarket-us-stream/worker.mjs',import.meta.url);
 let source=await readFile(file,'utf8');
 source=source.replace('import {DurableObject} from "cloudflare:workers";', 'class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }');
 source=source.replace(/from\s+["'](\.[^"']+)["']/g,(_,path)=>'from '+JSON.stringify(new URL(path,file).href));
 const {PolymarketMarketStream}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let fail=true;
 const DB={prepare(){return{bind(){return{async run(){if(fail)throw Error('D1 unavailable');return{meta:{changes:1}}}}}}}};
 const worker=new PolymarketMarketStream({waitUntil(){},storage:{async setAlarm(){}}},{DB});
 worker.subscribed.set('soccer-draw',{sport:'soccer',canonical_event_id:'game',event_start_time:'2026-10-17T14:00:00Z',market_family:'moneyline',period:'full_game',side:'Draw'});
 const tick={marketSlug:'soccer-draw',bestAsk:0.27,sourceObservedAt:'2026-10-15T16:44:00Z',at:'2026-10-15T16:44:01Z'};
 worker.queue.set(tick.marketSlug,tick);
 await worker.flush();
 assert.equal(worker.lastError,'d1-bbo-persist-error');assert.equal(worker.queue.size,1);
 clearTimeout(worker.flushTimer);worker.flushTimer=null;
 fail=false;await worker.flush();
 assert.equal(worker.queue.size,0);assert.equal(worker.inserted,1);assert.equal(worker.lastError,null);
 worker.lastError='upstream-subscription-error';worker.queue.set(tick.marketSlug,tick);await worker.flush();
 assert.equal(worker.lastError,'upstream-subscription-error');
});
