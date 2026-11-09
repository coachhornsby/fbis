import test from 'node:test';import assert from 'node:assert/strict';
import {decodeBoundedPolymarketSnapshot as decode,selectBoundedPolymarketOffers as select} from '../functions/lib/boundedPolymarketBoard.js';
const at=Date.parse('2026-11-07T05:00:20Z');
const iso=n=>new Date(n).toISOString();
const game={id:'fixture-1',sport:'cfb',start:'2026-11-07T17:00:00Z'};
const snapshot=()=>({version:1,source:'Polymarket US',scope:'BOUNDED_RESEARCH_CAPTURE',startedAt:iso(at-20000),capturedAt:iso(at),roster:[{sport:'cfb',source_market_id:'texas-missouri',canonical_event_id:game.id,market_family:'moneyline',event_start_time:game.start,collected_at:iso(at-30000),displayBinding:{version:1,contractLong:true,period:'full_game',side:'away',sourceOutcomeId:'texas',line:null}}],quotes:[{marketSlug:'texas-missouri',receivedAt:iso(at-1000),sourceObservedAt:iso(at-2000),bestBid:.55,bestAsk:.57,marketState:'MARKET_STATE_OPEN',quoteKind:'DISPLAY_REFERENCE_NOT_EXECUTABLE'}]});
const retained=(s=snapshot(),now=at+3600000)=>decode(s,{now,retainLastObserved:true});
test('strict reader still rejects old captures; display opt-in retains original quote and source times',()=>{
 const s=snapshot(),before=JSON.stringify(s);assert.equal(decode(s,{now:at+3600000}).ok,false);
 const v=retained(s),q=v.quotes[0];assert.equal(v.ok,true);assert.equal(q.bestAsk,.57);assert.equal(q.receivedAt,s.quotes[0].receivedAt);assert.equal(q.sourceObservedAt,s.quotes[0].sourceObservedAt);assert.equal(q.stale,true);assert.equal(q.fresh,false);assert.equal(q.ageSeconds,3601);assert.equal(q.sourceAgeSeconds,3602);assert.equal(JSON.stringify(s),before);
 const o=select(v,[game],'cfb').byId.get(game.id)[0];assert.equal(o.contractPrice,.57);assert.equal(o.stale,true);assert.equal(o.canQualify,false);assert.equal(o.canAuthorizeWager,false);assert.equal(o.executionEligible,false);assert.equal(o.marketAvailable,false);
});
test('unknown source time remains unknown, never substituted from capture or received time',()=>{const s=snapshot();s.quotes[0].sourceObservedAt=null;const q=retained(s).quotes[0];assert.equal(q.sourceObservedAt,null);assert.equal(q.sourceAgeSeconds,null);});
test('old source observation is stale even when receipt is recent, strict behavior remains rejected',()=>{const s=snapshot();s.quotes[0].sourceObservedAt=iso(at-600000);assert.equal(decode(s,{now:at}).quotes.length,0);const q=retained(s,at).quotes[0];assert.equal(q.stale,true);assert.equal(q.sourceObservedAt,iso(at-600000));});
test('explicit closed and invalid quotes return timestamped display invalidations only in opt-in mode',()=>{
 for(const [mutate,status] of [[q=>q.marketState='MARKET_STATE_CLOSED','closed'],[q=>q.marketState='MARKET_STATE_SUSPENDED','invalid'],[q=>q.bestAsk=null,'invalid'],[q=>q.bestBid=.9,'invalid'],[q=>q.sourceObservedAt='bad','invalid']]){
  const s=snapshot();mutate(s.quotes[0]);const v=retained(s);assert.equal(v.quotes.length,0);assert.equal(v.unavailableMarkets.length,1);assert.equal(v.unavailableMarkets[0].marketStatus,status);assert.equal(v.unavailableMarkets[0].receivedAt,s.quotes[0].receivedAt);assert.equal(v.unavailableMarkets[0].marketId,'texas-missouri');assert.deepEqual(decode(s,{now:at}).unavailableMarkets,[]);
 }
});
test('bad clocks, unrostered identities and corrupted bindings cannot clear retained prices',()=>{
 for(const mutate of [s=>s.quotes[0].receivedAt='bad',s=>s.quotes[0].receivedAt=iso(at+1),s=>s.quotes[0].receivedAt=iso(at-20001),s=>s.quotes[0].marketSlug='unrostered']){
  const s=snapshot();mutate(s);s.quotes[0].marketState='MARKET_STATE_CLOSED';const v=retained(s);assert.equal(v.quotes.length,0);assert.equal(v.unavailableMarkets.length,0);
 }
 const s=snapshot();s.roster[0].displayBinding.contractLong=false;assert.equal(retained(s).ok,false);
});
test('future/invalid snapshots and duplicate quote identities remain rejected in historical mode',()=>{const s=snapshot();assert.equal(retained(s,at-1).ok,false);s.quotes.push({...s.quotes[0]});assert.equal(retained(s).ok,false);assert.equal(decode(snapshot(),{now:NaN,retainLastObserved:true}).ok,false);});
test('a different canonical event or kickoff cannot receive the retained quote',()=>{const v=retained();assert.equal(select(v,[{...game,start:'2026-11-07T19:00:00Z'}],'cfb').byId.size,0);assert.equal(select(v,[{...game,id:'different'}],'cfb').byId.size,0);});

test('only source-supplied exact US market URLs survive; never invent a destination',()=>{
 const empty=select(retained(),[game],'cfb').byId.get(game.id)[0];assert.equal(empty.marketUrl,null);
 const good=snapshot();good.roster[0].marketUrl='https://polymarket.us/markets/texas-missouri';
 assert.equal(select(retained(good),[game],'cfb').byId.get(game.id)[0].marketUrl,good.roster[0].marketUrl);
 for(const url of ['https://polymarket.com/event/texas-missouri','https://evil.invalid/markets/texas-missouri','https://polymarket.us/events/texas-missouri','https://polymarket.us/markets/wrong','https://user@polymarket.us/markets/texas-missouri']){
  const s=snapshot();s.quotes[0].marketUrl=url;assert.equal(retained(s).quotes[0].marketUrl,null);
 }
});

test('REST display uses fifteen minutes, WS and strict readers retain two minutes',()=>{
 for(const age of [120001,600000,899000,901000]){
  const s=snapshot();s.quotes[0].sourceObservedAt=null;
  const rest=decode(s,{now:at+age,retainLastObserved:true,transport:'REST'});
  assert.equal(rest.quotes[0].stale,age+1000>900000);assert.equal(rest.stale,age>900000);
  assert.equal(rest.quotes[0].sourceObservedAt,null);assert.equal(rest.quotes[0].receivedAt,s.quotes[0].receivedAt);
  assert.equal(decode(s,{now:at+age,retainLastObserved:true,transport:'WebSocket'}).quotes[0].stale,true);
  assert.equal(decode(s,{now:at+age,transport:'REST'}).ok,false);
 }
 const s=snapshot();s.quotes[0].sourceObservedAt=iso(at-901000);
 assert.equal(decode(s,{now:at,retainLastObserved:true,transport:'REST'}).quotes[0].stale,true);
});

test('real card delivery keeps REST fresh at ten minutes and WS stale with identical clocks',async()=>{
 const {readExchangeCardQuotes}=await import('../functions/lib/exchangeCardDelivery.js');
 const {CERTIFIED_EXECUTION_JOBS}=await import('../services/account-budget/executionJobs.mjs');
 for(const rest of [true,false])for(const age of [600000,901000]){
  const clock=at+age,s=snapshot();s.quotes[0].sourceObservedAt=null;
  const manifest={version:1,source:'FBIS_COLLECTED_SLATE',sport:'cfb',capturedAt:iso(clock),expiresAt:iso(clock+3600000),providerTags:['cfb'],fixtures:[{...game,home_name:'Missouri',away_name:'Texas'}]};
  const env={CLOUDFLARE_ACCOUNT_ID:'test',FBIS_POLYMARKET_PREGAME_REST:String(rest),FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async({job})=>({allowed:true,maxUnits:CERTIFIED_EXECUTION_JOBS[job].units,expiresAtMs:Date.now()+120000})})},ARCHIVE:{get:async key=>{
   const value=key.includes('fixtures-v1')?manifest:key.includes('bounded-rest-v1')?{referenceSnapshot:s}:key.includes('bounded/latest-v1')?s:null;
   if(!value)return null;const text=JSON.stringify(value);return {size:Buffer.byteLength(text),body:new Response(text).body,json:async()=>JSON.parse(text)};
  }}};
  const out=await readExchangeCardQuotes(env,{sport:'cfb',date:'2026-11-07',now:clock});
  const q=out.byEvent[game.id][0];assert.equal(q.transport,rest?'REST':'WebSocket');assert.equal(q.stale,!rest||age>900000);assert.equal(q.receivedAt,s.quotes[0].receivedAt);assert.equal(q.sourceObservedAt,null);assert.equal(q.canAuthorizeWager,false);
 }
});
