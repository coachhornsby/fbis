import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExchangeProp,latestExchangeProps } from '../functions/lib/exchangePlayerProps.js';
import { onRequestGet } from '../functions/api/exchange-player-props.js';
import { verifiedLastFive } from '../src/features/playerProps/verifiedHistory.js';
const now=Date.parse('2026-10-20T13:30:00Z');
function fixture() {
  const r={id:'obs',source:'Kalshi',sport:'nfl',market_family:'player_prop',canonical_event_id:'nfl-1',canonical_player_id:'gsis-1',provider_event_id:'event-1',provider_player_id:'player-1',source_market_id:'contract-1',source_outcome_id:'yes',stat_family:'receiving_yards',period:'full_game',side:'yes',line:60,event_start_time:'2026-10-20T23:00:00Z',source_observed_at:'2026-10-20T13:29:00Z',collected_at:'2026-10-20T13:29:10Z'};
  r.raw_payload_json=JSON.stringify({bestAsk:.45,askSize:12,quoteSide:'yes',priceSemantics:'purchase_ask',marketState:'OPEN',playerPropIdentity:{verified:true,canonicalEventId:r.canonical_event_id,canonicalPlayerId:r.canonical_player_id,providerEventId:r.provider_event_id,providerPlayerId:r.provider_player_id,contractId:r.source_market_id,stat:r.stat_family,period:r.period,side:r.side,threshold:r.line,eventStart:r.event_start_time,settlementVerified:true,settlementTerms:'YES when official receiving yards exceed 60; full game includes overtime.'}});
  return r;
}
function changeRaw(r,fn) { const raw=JSON.parse(r.raw_payload_json);fn(raw);r.raw_payload_json=JSON.stringify(raw);return r; }
test('verified purchase ask stays observational and never gains betting authority',()=>{
 const p=normalizeExchangeProp(fixture(),{now});assert.equal(p.marketAvailable,true);assert.equal(p.purchaseAsk,.45);assert.equal(p.canQualify,false);assert.equal(p.canAuthorizeWager,false);assert.equal(p.fbis_projection,null);assert.equal(p.expectedReturn,null);
});
for(const field of ['canonical_event_id','canonical_player_id','provider_event_id','provider_player_id','source_market_id','stat_family','period','side','line','event_start_time']) {
 test(`rejects contract identity mismatch: ${field}`,()=>{const r=fixture();r[field]=field==='line'?61:'wrong';assert.equal(normalizeExchangeProp(r,{now}).marketAvailable,false);});
}
test('rejects name-only identity and missing settlement',()=>{
 for(const fn of [r=>{delete r.playerPropIdentity;},r=>{r.playerPropIdentity.settlementVerified=false;}]) assert.equal(normalizeExchangeProp(changeRaw(fixture(),fn),{now}).marketAvailable,false);
});
test('last trade, bid, midpoint, wrong-side asks, missing depth and closed quotes are not purchase asks',()=>{
 for(const patch of [{priceSemantics:'last_trade'},{priceSemantics:'midpoint'},{priceSemantics:'bid'},{quoteSide:'no'},{askSize:0},{marketState:'CLOSED'},{bestAsk:null}]) assert.equal(normalizeExchangeProp(changeRaw(fixture(),r=>Object.assign(r,patch)),{now}).marketAvailable,false);
});
test('rejects stale, future, absent and impossible quote clocks',()=>{
 for(const patch of [{source_observed_at:'2026-10-20T12:00:00Z'},{source_observed_at:null},{source_observed_at:'2026-10-21T13:00:00Z'},{collected_at:'2026-10-20T13:28:00Z'}]) assert.equal(normalizeExchangeProp({...fixture(),...patch},{now}).marketAvailable,false);
});
test('legacy providers cannot enter active exchange cards',()=>{for(const source of ['PrizePicks','prizepicks_free_mirror','ACTION','PinnOdds']) assert.equal(normalizeExchangeProp({...fixture(),source},{now}),null);});
test('provider-specific contracts stay distinct and newer closed quote supersedes old ask',()=>{
 const r=fixture(),newer=changeRaw({...r,id:'new',collected_at:'2026-10-20T13:29:30Z'},p=>{p.marketState='CLOSED';});
 const result=latestExchangeProps([r,newer,{...r,id:'poly',source:'Polymarket US'}],{now});assert.equal(result.length,2);assert.equal(result.find(p=>p.provider==='Kalshi').marketAvailable,false);
});
test('last five omit null/DNP/canceled values, preserve real zero and pushes, deduplicate and order oldest first',()=>{
 const games=[...Array.from({length:7},(_,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,value:i===6?0:i,opponent:'OPP'})),{date:'2026-10-09',value:null},{date:'2026-10-10',value:0,status:'DNP'},{date:'2026-10-11',value:0,status:'CANCELED'},{date:'2026-10-07',value:0}];
 assert.deepEqual(verifiedLastFive(games).map(g=>g.value),[2,3,4,5,0]);
});
test('API reads Q4 and primary, rejects invalid dates, and distinguishes store errors',async()=>{
 const queries=[];const db={prepare(sql){queries.push(sql);return{async all(){return{results:[]};},bind(...params){if(sql.includes('normalized_market_observations')){assert.equal(params[0],'2026-10-20T05:00:00.000Z');assert.equal(params[1],'2026-10-21T05:00:00.000Z');}return{async all(){return{results:[]};}};}};}};
 const result=await onRequestGet({env:{DB:db,MARKET_HISTORY_2026Q4_DB:db},request:new Request('https://fbis.test/api/exchange-player-props?date=2026-10-20')});
 const body=await result.json();assert.equal(body.ok,true);assert.equal(queries.filter(q=>q.includes('normalized_market_observations')).length,1);assert.equal(body.coverage.length,22);assert.ok(body.coverage.every(c=>c.status==='MARKET_UNAVAILABLE'));
 const missing=await (await onRequestGet({env:{},request:new Request('https://fbis.test/api/exchange-player-props?date=2026-10-20')})).json();assert.equal(missing.degraded,true);assert.ok(missing.coverage.every(c=>c.status==='COVERAGE_UNKNOWN'));
 assert.equal((await onRequestGet({env:{},request:new Request('https://fbis.test/api/exchange-player-props?date=2026-02-30')})).status,400);
});
