import test from 'node:test';
import assert from 'node:assert/strict';
import {exchangeMarketLink,exchangeLinksForGame} from '../src/lib/exchangeMarketLinks.js';

test('Kalshi exact source ticker navigates to that market, not a generic sport board',()=>{
 const x=exchangeMarketLink({source:'Kalshi',sourceMarketId:'KXNFLPASSYDS-26OCT25MINKC-250'});
 assert.deepEqual(x,{url:'https://kalshi.com/markets/kxnflpassyds-26oct25minkc-250',
  provider:'Kalshi',scope:'MARKET',id:'KXNFLPASSYDS-26OCT25MINKC-250',label:'Open on Kalshi'});
 for(const ticker of ['', 'KXNFLPASSYDS','https://malicious.test/market','KXNBA-PROP?redirect=https://bad.test']){
  assert.equal(exchangeMarketLink({source:'Kalshi',sourceMarketId:ticker}),null);
 }
 assert.equal(exchangeMarketLink({source:'Kalshi',sourceMarketId:'KXNHLGAME-26OCT25NYRNYI-NYR'}).scope,'MARKET');
});

test('Polymarket Global only emits documented source event URL; never assumes market slug is event slug',()=>{
 const base={source:'Polymarket Global Gamma',venue:'Polymarket Global',contractId:'player-rebounds-10',
  providerEventSlug:'nba-bos-nyk-2026-10-25'};
 const link=exchangeMarketLink(base);
 assert.equal(link.url,'https://polymarket.com/event/nba-bos-nyk-2026-10-25');
 assert.equal(link.scope,'EVENT');
 assert.equal(exchangeMarketLink({...base,providerEventSlug:null}),null);
 assert.equal(exchangeMarketLink({...base,providerEventSlug:'nba-bos-nyk?redirect=evil'}),null);
});

test('US market links must be exact source URLs with the same contract ID',()=>{
 const base={source:'Polymarket US',sourceMarketId:'nfl-buf-nyj-ml'};
 assert.equal(exchangeMarketLink(base),null);
 assert.equal(exchangeMarketLink({...base,marketUrl:'https://polymarket.com/event/nfl-buf-nyj-ml'}),null);
 assert.equal(exchangeMarketLink({...base,marketUrl:'https://polymarket.us.evil.com/markets/nfl-buf-nyj-ml'}),null);
 assert.equal(exchangeMarketLink({...base,marketUrl:'https://polymarket.us/sports/nfl'}),null);
 assert.equal(exchangeMarketLink({...base,marketUrl:'https://polymarket.us/markets/another-market'}),null);
 const ok=exchangeMarketLink({...base,marketUrl:'https://polymarket.us/markets/nfl-buf-nyj-ml'});
 assert.equal(ok.scope,'MARKET');
 assert.equal(ok.url,'https://polymarket.us/markets/nfl-buf-nyj-ml');
});

test('game links use matched offers and unique exact contracts, not unrelated market overlays',()=>{
 const game={sport:'cfb',id:'401A',market:{venueOffers:[
  {source:'Kalshi',sourceMarketId:'KXNCAAFGAME-26OCT25TEXOU-TEX',marketFamily:'moneyline',side:'home'},
  {source:'Kalshi',sourceMarketId:'KXNCAAFGAME-26OCT25TEXOU-TEX',marketFamily:'moneyline',side:'home'},
  {source:'Polymarket US',sourceMarketId:'unknown-market',marketFamily:'moneyline',side:'away'},
  {source:'PinnOdds',sourceMarketId:'Pinn-123',marketFamily:'spread',side:'home'}
 ]}};
 const all=exchangeLinksForGame(game);
 assert.equal(all.length,1);assert.equal(all[0].provider,'Kalshi');
 assert.match(all[0].description,/moneyline · home/);
});

test('tennis event navigation remains distinct from Kalshi exact ticker',()=>{
 const game={sport:'tennis',tennisProjection:{
  kalshiResearchOffers:[{ticker:'KXATPMATCH-26OCT25SAMPLE-P1',yesLabel:'Sample Player'}],
  polymarketGlobalOffers:[{eventSlug:'tennis-sample-player-match',marketId:'sample-market'}]
 }};
 const l=exchangeLinksForGame(game);
 assert.equal(l.length,2);
 assert.ok(l.some(x=>x.scope==='MARKET'&&x.provider==='Kalshi'));
 assert.ok(l.some(x=>x.scope==='EVENT'&&x.provider==='Polymarket Global'));
});
