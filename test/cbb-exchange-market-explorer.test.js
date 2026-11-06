import test from 'node:test';
import assert from 'node:assert/strict';
import {parseKalshiCbbFirstHalfTotalRule,matchedKalshiCbbFirstHalfTotals} from '../functions/lib/kalshiFirstHalfTotalQuotes.js';
import {exchangeGameMarkets,formatAmericanFromCost,marketCoverageStatus} from '../src/lib/exchangeMarketExplorer.js';
import {KALSHI_SHADOW_SERIES,normalizeKalshiShadowMarket} from '../functions/lib/kalshiMarketShadow.js';
const rule="Resolves Yes if over 67.5 total points are scored in the 1st half of the Michigan vs UConn men's college basketball game originally scheduled for Nov 6, 2026.";
const now=Date.parse('2026-11-06T21:35:00Z');
test('Kalshi first-half series is a separate source',()=>{
 assert.equal(KALSHI_SHADOW_SERIES.cbb_1h_total,'KXNCAAMB1HTOTAL');
 const m=normalizeKalshiShadowMarket({ticker:'KXNCAAMB1HTOTAL-26NOV06MICHCONN-68',event_ticker:'KXNCAAMB1HTOTAL-26NOV06MICHCONN',rules_primary:rule,yes_ask_dollars:'0.54',no_ask_dollars:'0.46'}, {sport:'cbb_1h_total',fetchedAt:new Date(now).toISOString()});
 assert.equal(m?.seriesTicker,'KXNCAAMB1HTOTAL');assert.equal(m.canAuthorizeWager,false);
});
test('only explicit first-half total rules pass',()=>{
 const r=parseKalshiCbbFirstHalfTotalRule(rule);
 assert.equal(r?.line,67.5);assert.equal(r?.period,'1h');assert.equal(r?.date,'2026-11-06');
 assert.equal(parseKalshiCbbFirstHalfTotalRule(rule.replace('1st half','game')),null);
 assert.equal(parseKalshiCbbFirstHalfTotalRule(rule.replace('Michigan','Unknown Madeup School')),null);
 assert.equal(parseKalshiCbbFirstHalfTotalRule(rule.replace('67.5','67')),null);
});
test('first-half quotes require exact game and period identity',()=>{
 const snapshot={ok:true,sport:'cbb_1h_total',seriesTicker:'KXNCAAMB1HTOTAL',capturedAt:new Date(now).toISOString(),records:[{
  sport:'cbb_1h_total',seriesTicker:'KXNCAAMB1HTOTAL',eventTicker:'KXNCAAMB1HTOTAL-26NOV06MICHCONN',ticker:'KXNCAAMB1HTOTAL-26NOV06MICHCONN-68',status:'active',fetchedAt:new Date(now-5000).toISOString(),
  rulesPrimary:rule,yesAskDollars:0.55,noAskDollars:0.46
 }]};
 const games=[{id:'401000123',sport:'cbb',start:'2026-11-07T01:00:00Z',away_name:'Michigan',home_name:'UConn'}];
 const results=matchedKalshiCbbFirstHalfTotals(games,snapshot,{now});
 assert.equal(results['401000123']?.length,2);
 assert.deepEqual(results['401000123'].map(x=>x.side),['over','under']);
 assert.ok(results['401000123'].every(x=>x.period==='1h'&&x.canAuthorizeWager===false));
 assert.deepEqual(matchedKalshiCbbFirstHalfTotals([{...games[0],home_name:'Purdue'}],snapshot,{now}),{});
 assert.deepEqual(matchedKalshiCbbFirstHalfTotals(games,{...snapshot,capturedAt:new Date(now-3600000).toISOString()},{now}),{});
});
test('per-game market view shows only exact matched offers and no made-up prices',()=>{
 const payload={ok:true,referenceOnly:true,canAuthorizeWager:false,byEvent:{G1:[
  {venue:'Kalshi',marketFamily:'total',period:'1h',side:'under',line:67.5,ask:0.46,receivedAt:new Date(now-1500).toISOString(),canAuthorizeWager:false,transport:'REST',marketId:'KX1'},
  {venue:'Kalshi',marketFamily:'total',side:'over',line:135.5,ask:0.53,receivedAt:new Date(now-1500).toISOString(),canAuthorizeWager:false,transport:'REST',marketId:'KX2'},
  {venue:'Polymarket',marketFamily:'moneyline',side:'home',ask:null,receivedAt:new Date(now-1500).toISOString(),canAuthorizeWager:false,transport:'WebSocket'}
 ],G2:[{venue:'Kalshi',marketFamily:'total',side:'under',ask:0.23,receivedAt:new Date(now-1500).toISOString(),canAuthorizeWager:false}]}};
 const rows=exchangeGameMarkets(payload,{id:'G1'},{now});
 assert.equal(rows.length,2);assert.equal(rows[0].period,'1h');assert.equal(rows[1].period,'game');
 assert.equal(rows[0].venue,'Kalshi');assert.equal(rows[0].american,Math.round(100*(1-0.46)/0.46));
 assert.equal(formatAmericanFromCost(0.6),'-150');
 assert.deepEqual(exchangeGameMarkets({...payload,canAuthorizeWager:true},{id:'G1'},{now}),[]);
});
test('missing first-half captures remain explicitly unknown',()=>{
 assert.equal(marketCoverageStatus({ok:true,marketSources:{Kalshi:{moneyline:{state:'CAPTURED'},first_half_total:{state:'NOT_CAPTURED'}}}},{venue:'Kalshi',period:'1h'}),'NOT_CAPTURED');
 assert.equal(marketCoverageStatus({ok:false},{venue:'Kalshi',period:'1h'}),'FEED_UNAVAILABLE');
});
