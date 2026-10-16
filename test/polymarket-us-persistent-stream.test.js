import test from "node:test";
import assert from "node:assert/strict";
import {
  STREAM_SPORTS,fairMarketSelection,manageSubscriptionCapacity,resolveStreamCapacity,
  shouldSaveBbo,liveBboOffer,parseStreamControl,streamIsHealthy,fetchStreamUpgrade,
  streamContractRosterWindow,STREAM_SUBSCRIBE_BATCH_MAX,dedupeEligibleContracts,
} from "../services/polymarket-us-stream/core.mjs";
import {polymarketUsSubscribe,polymarketUsSubscribeBatches,POLYMARKET_US_SUBSCRIBE_BATCH_MAX} from "../functions/lib/polymarketUsSignedWs.js";

test("persistent market selection distributes subscriptions over all supported sports",()=>{
 const rows=STREAM_SPORTS.flatMap(s=>Array.from({length:5},(_,i)=>({
   sport:s,source_market_id:s+"-"+i,canonical_event_id:s+"-game"
 })));
 const selected=fairMarketSelection(rows,{perSport:4,maxMarkets:44});
 assert.equal(selected.length,44);
 assert.equal(new Set(selected.map(x=>x.sport)).size,11);
 assert.equal(new Set(selected.map(x=>x.source_market_id)).size,44);
});

test("dynamic capacity retires the fixed 48 bottleneck and keeps all 11 sports",()=>{
  const rows=STREAM_SPORTS.flatMap(s=>Array.from({length:20},(_,i)=>({
    sport:s,source_market_id:`${s}-m-${i}`,canonical_event_id:`${s}-g-${i}`,
    market_family:i%3===0?"moneyline":i%3===1?"spread":"total",
    event_start_time:`2026-10-18T${String(12+(i%6)).padStart(2,"0")}:00:00Z`,
    collected_at:"2026-10-16T12:00:00Z",
  })));
  // Stress: 75 CFB + large CBB + other sports (synthetic inventory).
  const stress=[
    ...Array.from({length:75},(_,i)=>({sport:"cfb",source_market_id:`cfb-x-${i}`,canonical_event_id:`cfb-e-${i}`,market_family:"moneyline",event_start_time:"2026-10-18T18:00:00Z",collected_at:"2026-10-16T12:00:00Z"})),
    ...Array.from({length:100},(_,i)=>({sport:"cbb",source_market_id:`cbb-x-${i}`,canonical_event_id:`cbb-e-${i}`,market_family:"moneyline",event_start_time:"2026-10-18T19:00:00Z",collected_at:"2026-10-16T12:00:00Z"})),
    ...Array.from({length:20},(_,i)=>({sport:"nfl",source_market_id:`nfl-x-${i}`,canonical_event_id:`nfl-e-${i}`,market_family:"moneyline",event_start_time:"2026-10-18T20:00:00Z",collected_at:"2026-10-16T12:00:00Z"})),
    ...Array.from({length:15},(_,i)=>({sport:"nba",source_market_id:`nba-x-${i}`,canonical_event_id:`nba-e-${i}`,market_family:"moneyline",event_start_time:"2026-10-18T21:00:00Z",collected_at:"2026-10-16T12:00:00Z"})),
    ...Array.from({length:15},(_,i)=>({sport:"nhl",source_market_id:`nhl-x-${i}`,canonical_event_id:`nhl-e-${i}`,market_family:"moneyline",event_start_time:"2026-10-18T22:00:00Z",collected_at:"2026-10-16T12:00:00Z"})),
    ...Array.from({length:20},(_,i)=>({sport:"mlb",source_market_id:`mlb-x-${i}`,canonical_event_id:`mlb-e-${i}`,market_family:"moneyline",event_start_time:"2026-10-18T23:00:00Z",collected_at:"2026-10-16T12:00:00Z"})),
    ...Array.from({length:30},(_,i)=>({sport:"soccer",source_market_id:`soc-x-${i}`,canonical_event_id:`soc-e-${i}`,market_family:"moneyline",event_start_time:"2026-10-19T01:00:00Z",collected_at:"2026-10-16T12:00:00Z"})),
    ...Array.from({length:40},(_,i)=>({sport:"tennis",source_market_id:`ten-x-${i}`,canonical_event_id:`ten-e-${i}`,market_family:"moneyline",event_start_time:"2026-10-19T02:00:00Z",collected_at:"2026-10-16T12:00:00Z"})),
    ...Array.from({length:5},(_,i)=>({sport:"wnba",source_market_id:`wnba-x-${i}`,canonical_event_id:`wnba-e-${i}`,market_family:"moneyline",event_start_time:"2026-10-19T03:00:00Z",collected_at:"2026-10-16T12:00:00Z"})),
    ...Array.from({length:5},(_,i)=>({sport:"npb",source_market_id:`npb-x-${i}`,canonical_event_id:`npb-e-${i}`,market_family:"moneyline",event_start_time:"2026-10-19T04:00:00Z",collected_at:"2026-10-16T12:00:00Z"})),
    ...Array.from({length:5},(_,i)=>({sport:"kbo",source_market_id:`kbo-x-${i}`,canonical_event_id:`kbo-e-${i}`,market_family:"moneyline",event_start_time:"2026-10-19T05:00:00Z",collected_at:"2026-10-16T12:00:00Z"})),
  ];
  const plan=manageSubscriptionCapacity([...rows,...stress],{
    maxContracts:500,maxPerConnection:50,maxConnections:10,minPerSport:1,
  });
  assert.ok(plan.assignedCount>48,"must exceed retired 48-cap when inventory allows");
  assert.equal(plan.assignedCount,500);
  assert.ok(plan.uncoveredCount>0);
  assert.equal(plan.partitions.length,10);
  assert.ok(plan.partitions.every(p=>p.size<=50));
  for(const sport of STREAM_SPORTS){
    assert.ok(plan.bySport[sport].assigned>=1,`${sport} starved under large CFB/CBB inventory`);
    assert.notEqual(plan.bySport[sport].status,"UNAVAILABLE");
  }
  assert.equal(new Set(plan.assigned.map(r=>r.source_market_id)).size,plan.assignedCount);
});

test("capacity manager reports NO_VERIFIED_MARKETS for sports with empty inventory",()=>{
  const plan=manageSubscriptionCapacity([
    {sport:"nfl",source_market_id:"nfl-1",canonical_event_id:"g1",market_family:"moneyline",event_start_time:"2026-10-18T18:00:00Z"},
  ],{maxContracts:50,minPerSport:1});
  assert.equal(plan.bySport.nfl.assigned,1);
  assert.equal(plan.bySport.cfb.status,"NO_VERIFIED_MARKETS");
  assert.equal(plan.bySport.tennis.status,"NO_VERIFIED_MARKETS");
});

test("duplicate market slugs collapse to one active owner",()=>{
  const rows=[
    {sport:"nfl",source_market_id:"same",collected_at:"2026-10-16T10:00:00Z",canonical_event_id:"a"},
    {sport:"nfl",source_market_id:"same",collected_at:"2026-10-16T12:00:00Z",canonical_event_id:"b"},
  ];
  const deduped=dedupeEligibleContracts(rows);
  assert.equal(deduped.length,1);
  assert.equal(deduped[0].canonical_event_id,"b");
});

test("subscribe helper batches at 50 and scales via multiple frames",()=>{
  assert.equal(POLYMARKET_US_SUBSCRIBE_BATCH_MAX,STREAM_SUBSCRIBE_BATCH_MAX);
  const slugs=Array.from({length:120},(_,i)=>`mkt-${i}`);
  const one=polymarketUsSubscribe(slugs,"t");
  assert.equal(one.subscribe.market_slugs.length,50);
  const frames=polymarketUsSubscribeBatches(slugs,"t");
  assert.equal(frames.length,3);
  assert.equal(frames.reduce((n,f)=>n+f.subscribe.market_slugs.length,0),120);
});

test("resolveStreamCapacity reads soft env ceilings",()=>{
  const c=resolveStreamCapacity({
    STREAM_MAX_CONTRACTS:"300",STREAM_MAX_PER_CONNECTION:"50",STREAM_MAX_CONNECTIONS:"6",
  });
  assert.equal(c.maxContracts,300);
  assert.equal(c.maxPerConnection,50);
  assert.equal(c.maxConnections,6);
  assert.match(c.note,/Soft operational/i);
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

test("worker SQL returns large eligible inventory; capacity manager owns the cap",async()=>{
 const {readFileSync}=await import("node:fs");
 const worker=readFileSync(new URL("../services/polymarket-us-stream/worker.mjs",import.meta.url),"utf8");
 assert.match(worker,/PARTITION BY sport ORDER BY/);
 assert.match(worker,/WHERE sport_rank<=200/);
 assert.match(worker,/LIMIT 2200/);
 assert.match(worker,/manageSubscriptionCapacity/);
 assert.match(worker,/polymarketUsSubscribeBatches/);
 assert.match(worker,/fixedCapRetired:true/);
 assert.doesNotMatch(worker,/MAX_MARKETS\s*=\s*48/);
 assert.doesNotMatch(worker,/WHERE sport_rank<=6/);
 assert.doesNotMatch(worker,/collected_at DESC LIMIT 750/);
});

test("legacy fairMarketSelection adapter still returns unique assigned contracts",()=>{
 const rows=STREAM_SPORTS.flatMap(sport=>Array.from({length:6},(_,i)=>({
  sport,source_market_id:sport+"-contract-"+i,canonical_event_id:null
 })));
 const result=fairMarketSelection(rows,{perSport:6,maxMarkets:48});
 assert.equal(result.length,48);
 assert.equal(new Set(result.map(r=>r.source_market_id)).size,48);
 for(const sport of STREAM_SPORTS){
  assert.ok(result.filter(r=>r.sport===sport).length>=1,sport+" lost baseline coverage");
 }
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
 assert.equal(worker.persistenceStatus,'UNAVAILABLE');assert.equal(worker.inserted,0);
 clearTimeout(worker.flushTimer);worker.flushTimer=null;
 fail=false;await worker.flush();
 assert.equal(worker.queue.size,0);assert.equal(worker.inserted,1);assert.equal(worker.lastError,null);
 assert.equal(worker.persistenceStatus,'HEALTHY');
 worker.lastError='upstream-subscription-error';worker.queue.set(tick.marketSlug,tick);await worker.flush();
 assert.equal(worker.lastError,'upstream-subscription-error');
});

test("R2 spill on D1 failure preserves ticks without claiming inserted success",async()=>{
 const {readFile}=await import('node:fs/promises');
 const file=new URL('../services/polymarket-us-stream/worker.mjs',import.meta.url);
 let source=await readFile(file,'utf8');
 source=source.replace('import {DurableObject} from "cloudflare:workers";', 'class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }');
 source=source.replace(/from\s+["'](\.[^"']+)["']/g,(_,path)=>'from '+JSON.stringify(new URL(path,file).href));
 const {PolymarketMarketStream}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const puts=[];
 const ARCHIVE={async put(key,body){puts.push({key,body:JSON.parse(body)});}};
 const DB={prepare(){return{bind(){return{async run(){throw Error('D1 full')}}}}}};
 const worker=new PolymarketMarketStream({waitUntil(){},storage:{async setAlarm(){}}},{DB,ARCHIVE});
 worker.subscribed.set('nfl-ml',{sport:'nfl',canonical_event_id:'e1',event_start_time:'2026-10-19T17:00:00Z',market_family:'moneyline',period:'full_game',side:'Home'});
 const tick={marketSlug:'nfl-ml',bestAsk:0.55,bestBid:0.52,sourceObservedAt:'2026-10-16T20:00:00Z',at:'2026-10-16T20:00:01Z'};
 worker.queue.set(tick.marketSlug,tick);
 await worker.flush();
 clearTimeout(worker.flushTimer);worker.flushTimer=null;
 assert.equal(worker.lastError,'d1-bbo-persist-error');
 assert.equal(worker.inserted,0);
 assert.equal(worker.spilled,1);
 assert.equal(worker.persistenceStatus,'DEGRADED');
 assert.equal(worker.queue.size,0);
 assert.ok(worker.lastSpillKey?.includes('stream-spill/'));
 assert.equal(puts.length,1);
 assert.equal(puts[0].body.kind,'d1-persist-failure-spill');
 assert.equal(puts[0].body.recoveryOnly,true);
 assert.equal(puts[0].body.ticks[0].bestAsk,0.55);
 assert.equal(worker.status().operational,false);
 assert.equal(worker.status().persistenceStatus,'DEGRADED');
});
