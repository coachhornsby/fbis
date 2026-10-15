import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePolymarketUsTrade,parsePolymarketUsLite,polymarketUsSubscribe} from '../functions/lib/polymarketUsSignedWs.js';
import {flowSummary,simulateBuy,probabilityAmerican} from '../functions/lib/polymarketFlow.js';
const now=Date.parse('2026-10-15T07:00:00Z');
const msg=(intent='ORDER_INTENT_BUY_LONG',side='ORDER_SIDE_BUY')=>({trade:{marketSlug:'a-b',price:{value:'.55',currency:'USD'},quantity:{value:'0.5',currency:'USD'},tradeTime:new Date(now-1000).toISOString(),maker:{side:'ORDER_SIDE_SELL',intent:'ORDER_INTENT_SELL_LONG'},taker:{intent,side}}});
test('classifies every taker intent against the YES instrument and retains provider units',()=>{
 for(const [i,s,d] of [['BUY_LONG','BUY',1],['SELL_SHORT','BUY',1],['SELL_LONG','SELL',-1],['BUY_SHORT','SELL',-1]]){
 const t=parsePolymarketUsTrade(msg('ORDER_INTENT_'+i,'ORDER_SIDE_'+s));assert.equal(t.direction,d);assert.equal(t.quantity,.5);assert.equal(t.quantityUnit,'PROVIDER_AMOUNT_USD');}
 assert.equal(parsePolymarketUsTrade(msg('ORDER_INTENT_BUY_SHORT','ORDER_SIDE_BUY')).direction,0);
 assert.equal(parsePolymarketUsTrade({marketData:{}}),null);
 assert.equal(parsePolymarketUsTrade({...msg(),trade:{...msg().trade,quantity:{value:'-1'}}}),null);
});
test('subscriptions respect documented 100 capacity and trades are not debounced',()=>{
 const slugs=Array.from({length:110},(_,i)=>'market-'+i);
 const s=polymarketUsSubscribe(slugs,'trades',{trades:true});assert.equal(s.subscribe.market_slugs.length,100);assert.equal(s.subscribe.subscription_type,'SUBSCRIPTION_TYPE_TRADE');assert.equal(s.subscribe.responses_debounced,false);
});
test('full snapshots preserve fractional depth, nested stats and closed state',()=>{
 const t=parsePolymarketUsLite({marketData:{marketSlug:'a-b',state:'MARKET_STATE_SUSPENDED',bids:[{px:{value:'.5'},qty:'.25'}],offers:[],stats:{lastTradePx:{value:'.51'},sharesTraded:'1.75',openInterest:'2.25'},transactTime:new Date(now).toISOString()}});
 assert.equal(t.marketState,'MARKET_STATE_SUSPENDED');assert.equal(t.book.bids[0].quantity,.25);assert.equal(t.lastTrade,.51);assert.equal(t.stats.sharesTraded,1.75);
});
const trades=Array.from({length:10},(_,i)=>({...parsePolymarketUsTrade(msg()),at:new Date(now-1000-i*1000).toISOString(),direction:i<7?1:-1,quantity:1}));
const complete={trades,now,coverageStart:new Date(now-3600000).toISOString()};
test('one transaction per print; percentages use classified quantity, not makers plus takers',()=>{
 const s=flowSummary({...complete,trades:[...trades,trades[0]]});assert.equal(s.classifiedTrades,10);assert.equal(s.validQuantity,10);assert.equal(s.yesShare,.7);assert.equal(s.noShare,.3);assert.equal(s.canAuthorizeWager,false);
});
test('gaps, stale trades, insufficient samples, unknown units and truncation suppress percentages',()=>{
 for(const input of [{truncated:true},{coverageStart:new Date(now-10000).toISOString()},{gaps:[{start:new Date(now-100000).toISOString()}]},{now:now+300000},{trades:trades.slice(0,2)},{trades:trades.map(t=>({...t,quantityUnit:'UNKNOWN'}))}]){
 const s=flowSummary({...complete,...input});assert.equal(s.state,'INSUFFICIENT DATA');assert.equal(s.yesShare,null);}
});
test('future prints excluded; price movement opposing executed flow is mixed',()=>{
 const s=flowSummary({...complete,trades:[...trades,{...trades[0],at:new Date(now+100).toISOString()}],quotes:[{at:new Date(now-800000).toISOString(),lastTrade:.6},{at:new Date(now-1000).toISOString(),lastTrade:.55}]});assert.equal(s.classifiedTrades,10);assert.equal(s.state,'MIXED SIGNALS');assert.ok(Math.abs(s.movement.changePp+5)<1e-8);
});
test('simulation fails closed on stale quotes and unknown units/fees; depth limits realistic fills',()=>{
 const asks=[{price:.5,quantity:1},{price:.6,quantity:2}];const opts={at:now,quoteAt:new Date(now-1000).toISOString(),marketState:'MARKET_STATE_OPEN',quantityUnit:'CONTRACTS',fairProbability:.7};
 assert.equal(simulateBuy(asks,2,{}).available,false);
 const a=simulateBuy(asks,2,opts);assert.equal(a.cost,1.1);assert.equal(a.netExpectedProfit,null);
 const b=simulateBuy(asks,4,opts);assert.equal(b.available,false);assert.equal(b.unfilled,1);
 const feeRule={verified:true,effectiveFrom:'2026-10-07T14:00:00Z',effectiveUntil:'2026-10-19T17:00:00Z',coefficient:.0695,version:'test-verified'};
 const c=simulateBuy(asks,2,{...opts,feeRule});assert.equal(c.fee,.04);assert.ok(Math.abs(c.netExpectedProfit-.26)<1e-8);
 assert.equal(probabilityAmerican(.6),-150);assert.equal(probabilityAmerican(null),null);
});
