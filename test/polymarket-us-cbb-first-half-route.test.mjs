import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedCbbFirstHalfTotalBinding,verifiedFullGameDisplayBinding} from '../services/polymarket-rest-collector/collector.mjs';
import {validateStreamRoster} from '../services/polymarket-us-stream/boundedSession.mjs';
import {polymarketUsMarketOffers} from '../functions/lib/polymarketUs.js';
import {exchangeGameMarkets} from '../src/lib/exchangeMarketExplorer.js';
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
