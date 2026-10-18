import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPolymarketOffer,maxPolymarketEntry,standardPolymarketFee} from '../src/lib/polymarketIntelligence.js';
import {contractPriceToAmerican} from '../src/lib/marketQuoteDisplay.js';
import {parsePolymarketUsLite,parsePolymarketUsTrade} from '../functions/lib/polymarketUsSignedWs.js';
const now=new Date('2026-10-18T06:00:00Z');
const quote={contractPrice:.58,sourceObservedAt:'2026-10-18T05:59:50Z',collectedAt:'2026-10-18T05:59:51Z',raw:{bestAsk:.58,bestBid:.56,marketState:'MARKET_STATE_OPEN',settlementVerified:true,offers:[{price:.58,quantity:100}]}};
test('probability conversion matches American convention without pretending to include fees',()=>{
 assert.equal(contractPriceToAmerican(.6),-150);assert.equal(contractPriceToAmerican(.4),150);assert.equal(contractPriceToAmerican(.5),-100);
 assert.equal(contractPriceToAmerican(1),null);assert.equal(contractPriceToAmerican(0),null);
});
test('same model changes assessment when price moves, without changing authority',()=>{
 const good=assessPolymarketOffer(quote,.62,{now});assert.equal(good.state,'CONSIDER');assert.ok(good.netEdge>.02);assert.ok(good.estimatedFee>0);
 const bad=assessPolymarketOffer({...quote,raw:{...quote.raw,bestAsk:.61,offers:[{price:.61,quantity:100}]}},.62,{now});assert.equal(bad.state,'PASS');assert.ok(bad.netEdge<0);
 assert.equal(good.canAuthorizeWager,false);assert.equal(good.canQualify,false);assert.equal(good.modelInfluence,'none');
 const limit=maxPolymarketEntry(.62);assert.ok(Math.abs(limit+standardPolymarketFee(limit)-.62)<1e-10);
});
test('size-aware book calculation removes apparent value when cheap depth is thin',()=>{
 const x=assessPolymarketOffer({...quote,raw:{...quote.raw,offers:[{price:.58,quantity:.5},{price:.7,quantity:100}]}},.62,{now});assert.equal(x.state,'PASS');assert.ok(x.averageEntry>.65);
});
test('missing clock, unknown settlement, halted markets, insufficient depth and kickoff prevent considerations',()=>{
 for(const q of [{...quote,sourceObservedAt:null},{...quote,raw:{...quote.raw,settlementVerified:false}},{...quote,raw:{...quote.raw,marketState:'MARKET_STATE_HALTED'}},{...quote,raw:{...quote.raw,offers:[]}}])assert.equal(assessPolymarketOffer(q,.8,{now}).state,'VERIFY');
 assert.equal(assessPolymarketOffer(quote,.8,{now,eventStart:'2026-10-18T05:00:00Z'}).state,'VERIFY');
 assert.equal(assessPolymarketOffer(quote,.8,{now:new Date('2026-10-18T06:02:00Z')}).state,'VERIFY');
});
test('full books retain depth and explicit suspension instead of keeping prior open quote silently',()=>{
 const x=parsePolymarketUsLite({marketData:{marketSlug:'valid-market',state:'MARKET_STATE_SUSPENDED',transactTime:'2026-10-18T05:59:00Z',bids:[],offers:[]}});
 assert.equal(x.marketState,'MARKET_STATE_SUSPENDED');assert.equal(x.bestAsk,null);
 const t=parsePolymarketUsTrade({trade:{marketSlug:'valid-market',price:{value:'.5'},quantity:{value:'12',currency:'USD'},tradeTime:'2026-10-18T05:59:00Z',taker:{side:'ORDER_SIDE_BUY'}}});
 assert.equal(t.price,.5);assert.equal(t.quantity,12);assert.equal(parsePolymarketUsTrade({order:{price:'.5'}}),null);
});

test('fees adapt to a supplied provider coefficient without adding unverified rebates',()=>{
 const x=assessPolymarketOffer({...quote,raw:{...quote.raw,feeCoefficient:.1}},.62,{now});
 assert.equal(x.feePolicy,'PROVIDER_COEFFICIENT_NO_REBATE');assert.ok(x.netEdge<assessPolymarketOffer(quote,.62,{now}).netEdge);
});

test('opposing contract uses one minus bid, not one minus ask or an invented soccer opponent',async()=>{
 const {liveBboOffers}=await import('../services/polymarket-us-stream/core.mjs');
 const tick={marketSlug:'binary-market',bestAsk:.6,bestBid:.56,bids:[{price:.56,quantity:20}],offers:[{price:.6,quantity:10}]};
 const base={sport:'nfl',side:'home',opposite:{side:'away',sourceOutcomeId:'no'}};
 const quotes=liveBboOffers(tick,base);assert.equal(quotes.length,2);assert.ok(Math.abs(quotes[1].contractPrice-.44)<1e-12);assert.equal(quotes[1].sourceOutcomeId,'no');
 assert.equal(liveBboOffers(tick,{...base,sport:'soccer'}).length,1);assert.equal(liveBboOffers(tick,{sport:'nfl'}).length,1);
});
