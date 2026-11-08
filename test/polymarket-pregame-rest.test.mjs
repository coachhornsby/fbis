import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBoundedPolymarketRest} from '../services/polymarket-rest-collector/collector.mjs';
import {pregameDiscoveryPlan,restReferenceSnapshot} from '../services/polymarket-rest-collector/pregame.mjs';
import {loadBoundedPolymarketSnapshot,selectBoundedPolymarketOffers} from '../functions/lib/boundedPolymarketBoard.js';
import {CERTIFIED_EXECUTION_JOBS} from '../services/account-budget/executionJobs.mjs';
const now=Date.now(),slot=Math.floor(now/60000),at=new Date(now).toISOString(),start=new Date(now+3600000).toISOString();
const fixture={id:'game-1',sport:'nfl',start,home_name:'Denver Broncos',away_name:'Seattle Seahawks'};
const manifest={version:1,source:'FBIS_COLLECTED_SLATE',sport:'nfl',capturedAt:at,expiresAt:start,providerTags:['nfl'],fixtures:[fixture]};
const event={id:'e1',slug:'nfl-sea-den',title:'Seattle Seahawks vs Denver Broncos',seriesSlug:'nfl',homeTeam:{name:'Denver Broncos'},awayTeam:{name:'Seattle Seahawks'},startTime:start,markets:[{id:'m1',slug:'contract-1',active:true,closed:false,sportsMarketTypeV2:'MONEYLINE',sportsMarketType:'nfl_full_game_moneyline',bestAskQuote:{value:'.54'},bestBidQuote:{value:'.52'},marketSides:[{id:'long-1',long:true,description:'Denver Broncos',quote:'.49',team:{name:'Denver Broncos'}}]}]};
function setup(){const objects=new Map([['market-sources/polymarket-us/fixtures-v1/nfl.json',manifest]]);let reads=0,writes=0;return {objects,stats:()=>({reads,writes}),FBIS_POLYMARKET_PREGAME_REST:'true',CLOUDFLARE_ACCOUNT_ID:'test',FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async({job})=>({allowed:true,maxUnits:CERTIFIED_EXECUTION_JOBS[job].units,expiresAtMs:Date.now()+120000})})},ARCHIVE:{head(){},async get(key){reads++;const value=objects.get(key);if(!value)return null;const text=JSON.stringify(value);return {size:Buffer.byteLength(text),body:new Response(text).body};},async put(key,text){writes++;objects.set(key,JSON.parse(text));return {etag:'saved'};}}};}
test('pregame REST flows through admitted capture and board without WebSocket or D1',async()=>{const env=setup();let calls=0;const result=await collectBoundedPolymarketRest(env,{sport:'nfl',slot,now,fetchImpl:async(url,init)=>{calls++;const u=new URL(url);assert.equal(u.pathname,'/v1/events');assert.equal(u.searchParams.get('startTimeMin'),new Date(Date.parse(start)-60000).toISOString());assert.equal(init.redirect,'manual');return Response.json({events:[event]});}});assert.equal(calls,1);assert.equal(result.selected.length,1);assert.deepEqual(env.stats(),{reads:1,writes:1});const snapshot=await loadBoundedPolymarketSnapshot(env,{sport:'nfl',now:new Date(now),retainLastObserved:true});assert.equal(snapshot.transport,'REST');const offer=selectBoundedPolymarketOffers(snapshot,[fixture],'nfl').byId.get('game-1')[0];assert.equal(offer.contractPrice,.54);assert.equal(offer.source,'Polymarket US REST');assert.equal(offer.providerObservedAt,null);assert.equal(offer.canAuthorizeWager,false);assert.equal(offer.executionEligible,false);assert.deepEqual(env.stats(),{reads:2,writes:1});});
test('window rotation is bounded and excludes already-started fixtures',()=>{const m={...manifest,fixtures:Array.from({length:20},(_,i)=>({...fixture,id:String(i),start:new Date(now+i*3600000).toISOString()}))};const a=pregameDiscoveryPlan(m,{now,slot:0}),b=pregameDiscoveryPlan(m,{now,slot:10});assert.equal(a.length,4);assert.equal(b.length,4);assert.notDeepEqual(a,b);assert.ok(a.every(q=>Date.parse(q.startTimeMin)>now));});
test('empty capture preserves old envelope; HTTP rejection is not retried',async()=>{const env=setup(),key='market-sources/polymarket-us/bounded-rest-v1/nfl/latest.json';env.objects.set(key,{old:true});let calls=0;const result=await collectBoundedPolymarketRest(env,{sport:'nfl',slot,now,fetchImpl:async()=>{calls++;return new Response(null,{status:403});}});assert.equal(calls,1);assert.equal(result.errors[0].status,403);assert.deepEqual(env.objects.get(key),{old:true});assert.equal(env.stats().writes,0);});
test('closed and crossed quotes become timestamped invalidations',()=>{const rows=[{sport:'nfl',source_market_id:'contract-1',canonical_event_id:'game-1',market_family:'moneyline',event_start_time:start,collected_at:at,displayBinding:{version:1,contractLong:true,period:'full_game',side:'home',line:null,sourceOutcomeId:'long-1'}}];for(const change of [{closed:true},{active:false},{bestAskQuote:{value:'.51'}},{bestAskQuote:null}])assert.equal(restReferenceSnapshot(rows,new Map([['contract-1',{...event.markets[0],...change}]]),now).quotes[0].marketState,change.closed?'MARKET_STATE_CLOSED':'MARKET_STATE_UNAVAILABLE');});
test('live event is excluded even before its scheduled kickoff',async()=>{const env=setup();const result=await collectBoundedPolymarketRest(env,{sport:'nfl',slot,now,fetchImpl:async()=>Response.json({events:[{...event,live:true}]})});assert.equal(result.selected.length,0);assert.equal(env.stats().writes,0);});

test('bad provider slug cannot replace a good capture',async()=>{const env=setup(),key='market-sources/polymarket-us/bounded-rest-v1/nfl/latest.json';env.objects.set(key,{old:true});await assert.rejects(()=>collectBoundedPolymarketRest(env,{sport:'nfl',slot,now,fetchImpl:async()=>Response.json({events:[{...event,markets:[{...event.markets[0],slug:'bad?slug'}]}]})}),/INVALID_STREAM_ROSTER_ROW/);assert.deepEqual(env.objects.get(key),{old:true});assert.equal(env.stats().writes,0);});
test('closed event overrides lingering live flag and invalidates old reference',async()=>{const env=setup();await collectBoundedPolymarketRest(env,{sport:'nfl',slot,now,fetchImpl:async()=>Response.json({events:[{...event,live:true,closed:true}]})});const snapshot=await loadBoundedPolymarketSnapshot(env,{sport:'nfl',now:new Date(now),retainLastObserved:true});assert.equal(snapshot.quotes.length,0);assert.equal(snapshot.unavailableMarkets[0].marketStatus,'closed');});

for (const [label, mutate] of [
 ['opposite side', m => ({...m, marketSides:[{id:'away-long',long:true,description:'Seattle Seahawks',team:{name:'Seattle Seahawks'}}]})],
 ['different outcome', m => ({...m, marketSides:m.marketSides.map(s=>({...s,id:'replacement-outcome'}))})],
 ['different market family', m => ({...m,sportsMarketTypeV2:'SPREAD',sportsMarketType:'nfl_full_game_spread',line:3.5,marketSides:[{id:'long-1',long:true,description:'Denver Broncos -3.5',team:{name:'Denver Broncos'}}]})],
]) test(`duplicate slug with ${label} cannot replace prior capture`,async()=>{
 const env=setup(),key='market-sources/polymarket-us/bounded-rest-v1/nfl/latest.json';
 env.objects.set(key,{old:true});
 const duplicate=mutate(event.markets[0]);
 await assert.rejects(()=>collectBoundedPolymarketRest(env,{sport:'nfl',slot,now,fetchImpl:async()=>Response.json({events:[{...event,markets:[event.markets[0],duplicate]}]})}),/AMBIGUOUS_PROVIDER_CONTRACT/);
 assert.deepEqual(env.objects.get(key),{old:true});assert.equal(env.stats().writes,0);
});
test('repeated identical contract identity remains valid and deduplicates',async()=>{
 const env=setup();
 const result=await collectBoundedPolymarketRest(env,{sport:'nfl',slot,now,fetchImpl:async()=>Response.json({events:[{...event,markets:[event.markets[0],{...event.markets[0],bestAskQuote:{value:'.55'}}]}]})});
 assert.equal(result.selected.length,1);assert.equal(env.stats().writes,1);
 const snapshot=await loadBoundedPolymarketSnapshot(env,{sport:'nfl',now:new Date(now),retainLastObserved:true});
 assert.equal(snapshot.quotes[0].bestAsk,.55);
});
test('unbound duplicate slug cannot supply a quote for an earlier verified contract',async()=>{
 const env=setup();
 const unbound={...event.markets[0],bestAskQuote:{value:'.99'},marketSides:[{id:'unknown',long:true,description:'Unknown outcome'}]};
 await collectBoundedPolymarketRest(env,{sport:'nfl',slot,now,fetchImpl:async()=>Response.json({events:[{...event,markets:[event.markets[0],unbound]}]})});
 const snapshot=await loadBoundedPolymarketSnapshot(env,{sport:'nfl',now:new Date(now),retainLastObserved:true});
 assert.equal(snapshot.quotes[0].bestAsk,.54);
});

test('unsupported duplicate period cannot overwrite verified full-game reference',async()=>{
 const env=setup();
 const unsupported={...event.markets[0],sportsMarketType:'nfl_first_half_moneyline',bestAskQuote:{value:'.77'}};
 await collectBoundedPolymarketRest(env,{sport:'nfl',slot,now,fetchImpl:async()=>Response.json({events:[{...event,markets:[event.markets[0],unsupported]}]})});
 const snapshot=await loadBoundedPolymarketSnapshot(env,{sport:'nfl',now:new Date(now),retainLastObserved:true});
 assert.equal(snapshot.roster[0].displayBinding.period,'full_game');
 assert.equal(snapshot.quotes[0].bestAsk,.54);
});
test('REST activation does not route non-collected sports away from existing WS capture',async()=>{
 for(const sport of ['mlb','tennis']){
  const env=setup();const keys=[];
  env.ARCHIVE.get=async key=>{keys.push(key);return null;};
  await loadBoundedPolymarketSnapshot(env,{sport,now:new Date(now),retainLastObserved:true});
  assert.equal(keys.length,1);
  assert.ok(!keys[0].includes('bounded-rest-v1/'));
 }
});
