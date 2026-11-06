import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedCbbFirstHalfTotalBinding,verifiedFullGameDisplayBinding,collectBoundedPolymarketRest} from '../services/polymarket-rest-collector/collector.mjs';
import {validateStreamRoster} from '../services/polymarket-us-stream/boundedSession.mjs';
import {polymarketUsMarketOffers} from '../functions/lib/polymarketUs.js';
import {exchangeGameMarkets} from '../src/lib/exchangeMarketExplorer.js';
import {selectBoundedPolymarketOffers} from '../functions/lib/boundedPolymarketBoard.js';
const now=Date.parse('2026-11-06T21:30:00Z');
const game={id:'401x',sport:'cbb',start:'2026-11-07T01:00:00Z',home_name:'Ohio State Buckeyes',away_name:'Youngstown State Penguins'};
const event={id:'p-event',seriesSlug:'cbb',startTime:game.start,homeTeam:{name:game.home_name},awayTeam:{name:game.away_name},title:'Youngstown State vs Ohio State'};
const offer=(period='first_half',description='Under')=>polymarketUsMarketOffers({...event,markets:[{
 id:'pm-one',slug:'cbb-1h-total-yng-osu-72-5',sportsMarketType:'cbb_'+period+'_total',sportsMarketTypeV2:'SPORTS_MARKET_TYPE_TOTAL',
 line:72.5,marketSides:[{id:'pm-side-1',long:true,description,quote:{value:'0.51'}}]
 }]},'cbb',{canonicalId:game.id,capturedAt:new Date(now).toISOString()})[0];
test('source-typed US CBB first-half total retained separately from full game',()=>{
 const o=offer();assert.equal(o.period,'first_half');assert.equal(o.marketFamily,'total');
 const b=verifiedCbbFirstHalfTotalBinding(o,game);
 assert.deepEqual(b,{version:1,contractLong:true,period:'first_half',sourceOutcomeId:'pm-side-1',side:'under',line:72.5});
 assert.equal(verifiedFullGameDisplayBinding(o,game),null);
 assert.equal(verifiedCbbFirstHalfTotalBinding(offer('full_game'),game),null);
});
test('ambiguous, invalid, non-first-half contracts cannot be promoted',()=>{
 const base=offer();for(const bad of [
 {...base,line:null},{...base,line:72},{...base,line:151.5},
 {...base,raw:{...base.raw,contractLong:false}},
 {...base,raw:{...base.raw,providerMarket:{...base.raw.providerMarket,sportsMarketType:'cbb_full_game_total'}}},
 {...base,raw:{...base.raw,providerSide:{description:'Winner'}}}
 ])assert.equal(verifiedCbbFirstHalfTotalBinding(bad,game),null);
});
test('stream admits only first-half CBB total with verified binding',()=>{
 const row={sport:'cbb',canonical_event_id:game.id,source_market_id:'cbb-1h-total-yng-osu-72-5',
 market_family:'total',event_start_time:game.start,collected_at:new Date(now).toISOString(),
 displayBinding:verifiedCbbFirstHalfTotalBinding(offer(),game)};
 const manifest=entries=>({version:2,source:'Polymarket US',capturedAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString(),roster:entries});
 assert.equal(validateStreamRoster(manifest([row]),now)[0].displayBinding.period,'first_half');
 for(const changed of [{...row,sport:'nba'}, {...row,market_family:'moneyline'}])
  assert.throws(()=>validateStreamRoster(manifest([changed]),now));
});
test('explorer displays Polymarket US 1st half quote independently from full-game',()=>{
 const payload={ok:true,referenceOnly:true,canAuthorizeWager:false,byEvent:{[game.id]:[{
 venue:'Polymarket',marketFamily:'total',period:'first_half',side:'under',line:72.5,
 ask:0.51,receivedAt:new Date(now-1000).toISOString(),transport:'WebSocket',canAuthorizeWager:false
 }]}};
 const rows=exchangeGameMarkets(payload,game,{now});
 assert.equal(rows.length,1);assert.equal(rows[0].period,'1h');assert.equal(rows[0].venue,'Polymarket US');
 assert.equal(rows[0].canAuthorizeWager,false);
});

test('verified opposite-side metadata admits a single US instrument for both sides',()=>{
 const source={...offer().raw.providerMarket,marketSides:[
  {id:'yes-id',description:'Over',long:true,quote:{value:0.55}},
  {id:'no-id',description:'Under',long:false,quote:{value:0.45}}
 ]};
 const offers=polymarketUsMarketOffers({...event,markets:[source]},'cbb',{canonicalId:game.id});
 const yes=offers.find(o=>o.raw.contractLong===true),no=offers.find(o=>o.raw.contractLong===false);
 assert.equal(yes.side,'Over');assert.equal(no.side,'Under');
 const binding={...verifiedCbbFirstHalfTotalBinding(yes,game),oppositeSide:'under',oppositeSourceOutcomeId:no.sourceOutcomeId};
 const entry={sport:'cbb',canonical_event_id:game.id,source_market_id:yes.sourceMarketId,
   market_family:'total',event_start_time:game.start,collected_at:new Date(now).toISOString(),displayBinding:binding};
 const raw={version:2,source:'Polymarket US',capturedAt:new Date(now).toISOString(),
   expiresAt:new Date(now+600000).toISOString(),roster:[entry]};
 assert.equal(validateStreamRoster(raw,now)[0].displayBinding.oppositeSide,'under');
 const snapshot={ok:true,code:'BOUNDED_REFERENCE_SNAPSHOT',capturedAt:new Date(now).toISOString(),
   roster:validateStreamRoster(raw,now),quotes:[{marketSlug:entry.source_market_id,bestBid:0.45,bestAsk:0.55,
   receivedAt:new Date(now).toISOString(),sourceObservedAt:null}]};
 const result=selectBoundedPolymarketOffers(snapshot,[{id:game.id,sport:'cbb',start:game.start}],'cbb');
 const actual=result.byId.get(game.id);
 assert.equal(actual.length,2);
 assert.equal(actual.find(o=>o.side==='over').contractPrice,0.55);
 assert.equal(actual.find(o=>o.side==='under').contractPrice,0.55);
 assert.equal(actual.find(o=>o.side==='under').quoteKind,'SYNTHETIC_NO_FROM_YES_BID_REFERENCE');
 assert.ok(actual.every(o=>o.canAuthorizeWager===false));
 const missing=selectBoundedPolymarketOffers({...snapshot,quotes:[{...snapshot.quotes[0],bestBid:null}]},
   [{id:game.id,sport:'cbb',start:game.start}],'cbb');
 assert.equal(missing.byId.get(game.id)?.length,1);
});

test('bounded CBB collector gets full event-by-slug markets with existing four-call limit',async()=>{
 const {CERTIFIED_EXECUTION_JOBS,POLY_REST_JOB}=await import('../services/account-budget/executionJobs.mjs');
 const manifest={version:1,source:'FBIS_COLLECTED_SLATE',sport:'cbb',
  capturedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),
  providerTags:['cbb'],fixtures:[game]};
 const eventSlug='cbb-yngst-ohiost-2026-11-06';
 const one={...event,slug:eventSlug,markets:[{
   slug:'cbb-yngst-ohiost-moneyline',sportsMarketType:'basketball_team_full_game_winner',
   sportsMarketTypeV2:'SPORTS_MARKET_TYPE_MONEYLINE',marketSides:[{id:'ml-side',description:game.home_name,long:true,team:{name:game.home_name}}]
 }]};
 const detailed={...one,markets:[{
   slug:'cbb-yngst-ohiost-1h-tot-72-5',sportsMarketType:'basketball_team_first_half_total',
   sportsMarketTypeV2:'SPORTS_MARKET_TYPE_TOTAL',line:72.5,
   marketSides:[{id:'yes-1',description:'Over',long:true},{id:'no-1',description:'Under',long:false}]
 }]};
 let calls=0,writes=0;
 const env={CLOUDFLARE_ACCOUNT_ID:'test',FBIS_ACCOUNT_BUDGET:{getByName:()=>({
  reserve:async({job})=>({allowed:true,maxUnits:CERTIFIED_EXECUTION_JOBS[job].units,expiresAtMs:Date.now()+120000})
 })},ARCHIVE:{head(){},async get(){const data=JSON.stringify(manifest);return {size:Buffer.byteLength(data),body:new Response(data).body};},
  async put(){writes++;return {etag:'saved'};}}};
 const result=await collectBoundedPolymarketRest(env,{sport:'cbb',slot:Math.floor(now/60000),now,
  fetchImpl:async request=>{
   calls++;const u=new URL(request);
   assert.equal(u.pathname,'/v1/events');
   if(u.searchParams.has('slug')){
    assert.equal(u.searchParams.get('slug'),eventSlug);
    return Response.json({events:[detailed]});
   }
   return Response.json({events:[one]});
  }});
 assert.ok(calls<=4);assert.equal(calls,2);
 assert.equal(writes,1);
 assert.ok(result.selected.some(r=>r.market_family==='total'&&r.displayBinding.period==='first_half'&&r.displayBinding.oppositeSide==='under'));
 assert.equal(result.receipt.complete,false);
});
