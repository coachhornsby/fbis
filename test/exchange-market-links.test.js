import test from 'node:test';
import assert from 'node:assert/strict';
import {exchangeMarketLink,exchangeLinksForGame} from '../src/lib/exchangeMarketLinks.js';
import {tennisMarketSnapshot} from '../src/lib/tennisCardPresentation.js';

const fixtures=[
 ['nfl','KXNFLGAME','nfl-game','26OCT25KCSEA','SEA'],
 ['cfb','KXNCAAFGAME','college-football-game','26SEP26IWTXST','TXST'],
 ['nba','KXNBAGAME','nba-game','26OCT21GSWLAL','LAL'],
 ['cbb','KXNCAAMBGAME','mens-college-basketball-mens-game','26MAR07HOUOKST','HOU'],
 ['mlb','KXMLBGAME','professional-baseball-game','26SEP271510TEXMIN','MIN'],
 ['nhl','KXNHLGAME','nhl-game','26SEP21STLDAL','DAL'],
 ['tennis ATP','KXATPMATCH','atp-tennis-match','26SEP27MANSHA','SHA'],
 ['tennis WTA','KXWTAMATCH','wta-tennis-match','26OCT25WANPAR','PAR']
];
test('all seven active sports construct full event routes with the EXACT selection ticker',()=>{
 for(const [sport,series,slug,code,side] of fixtures){
  const eventTicker=series+'-'+code,ticker=eventTicker+'-'+side;
  const link=exchangeMarketLink({source:'Kalshi',ticker,eventTicker,sport});
  assert.ok(link,sport);
  assert.equal(link.scope,'MARKET',sport);
  assert.equal(link.id,ticker);
  assert.equal(link.url,`https://kalshi.com/markets/${series.toLowerCase()}/${slug}/${eventTicker.toLowerCase()}?op_market_ticker=${ticker}`,sport);
  assert.notEqual(link.url,`https://kalshi.com/markets/${ticker.toLowerCase()}`);
 }
});
test('no guessed Kalshi routes from market ticker alone, mismatched events, or unknown categories',()=>{
 const ticker='KXATPMATCH-26SEP27MANSHA-SHA',eventTicker='KXATPMATCH-26SEP27MANSHA';
 assert.equal(exchangeMarketLink({source:'Kalshi',ticker}),null);
 assert.equal(exchangeMarketLink({source:'Kalshi',ticker,eventTicker:'KXATPMATCH-26SEP29OTHER'}),null);
 assert.equal(exchangeMarketLink({source:'Kalshi',ticker:'KXNFLPASSYDS-26OCT25KCSEA-200',eventTicker:'KXNFLPASSYDS-26OCT25KCSEA'}),null);
 for(const url of ['https://evil.com/markets/kxatpmatch?op_market_ticker='+ticker,
                    'https://kalshi.com/markets/kxatpmatch?op_market_ticker=WRONG',
                    'https://kalshi.com.evil.com/markets/kxatpmatch?op_market_ticker='+ticker]){
  assert.equal(exchangeMarketLink({source:'Kalshi',ticker,eventTicker,marketUrl:url}),null);
 }
});
test('provider-supplied Kalshi exact URL supports currently unmapped sport/stat series',()=>{
 const market='KXNFLPASSYDS-26OCT25KCSEA-200';
 const url='https://kalshi.com/markets/kxnflpassyds/passing-yards/kxnflpassyds-26oct25kcsea?op_market_ticker='+market;
 const x=exchangeMarketLink({source:'Kalshi',ticker:market,marketUrl:url});
 assert.equal(x.url,url);
});
test('Polymarket Global links identify the exact sourced event, not a fabricated contract route',()=>{
 const x=exchangeMarketLink({source:'Polymarket Global Gamma',venue:'Polymarket Global',providerEventSlug:'nba-bos-nyk-2026-10-25',contractId:'points-30'});
 assert.equal(x.url,'https://polymarket.com/event/nba-bos-nyk-2026-10-25');
 assert.equal(x.scope,'EVENT');
 assert.equal(exchangeMarketLink({source:'Polymarket Global Gamma',contractId:'points-30'}),null);
 assert.equal(exchangeMarketLink({source:'Polymarket Global Gamma',providerEventSlug:'nba-bos?evil=true'}),null);
});
test('Polymarket US requires exact source URL, domain, and matching market identifier',()=>{
 const base={source:'Polymarket US',sourceMarketId:'nfl-buf-nyj-ml'};
 for(const url of [null,'https://polymarket.com/event/nfl-buf-nyj-ml',
    'https://polymarket.us.evil.com/markets/nfl-buf-nyj-ml',
    'https://polymarket.us/sports/nfl','https://polymarket.us/markets/different']){
  assert.equal(exchangeMarketLink({...base,marketUrl:url}),null);
 }
 assert.equal(exchangeMarketLink({...base,marketUrl:'https://polymarket.us/markets/nfl-buf-nyj-ml'})?.scope,'MARKET');
});
test('tennis snapshot retains participant-specific Kalshi and Polymarket links after sorting',()=>{
 const a='KXATPMATCH-26SEP27MANSHA',links={
  kalshiResearchOffers:[
   {yesLabel:'Denis Shapovalov',ticker:a+'-SHA',eventTicker:a,yesAskDollars:.7},
   {yesLabel:'Adrian Mannarino',ticker:a+'-MAN',eventTicker:a,yesAskDollars:.32}
  ],
  polymarketGlobalOffers:[{
    question:'Mannarino vs Shapovalov match winner',outcomes:['Adrian Mannarino','Denis Shapovalov'],
    indicativePrices:[.32,.68],eventSlug:'mannarino-shapovalov'
  }]
 };
 const snapshot=tennisMarketSnapshot(links,[],['Adrian Mannarino','Denis Shapovalov']);
 assert.equal(snapshot.kalshi[0].name,'Adrian Mannarino');
 assert.match(snapshot.kalshi[0].link.url,/op_market_ticker=KXATPMATCH-26SEP27MANSHA-MAN/);
 assert.equal(snapshot.kalshi[1].name,'Denis Shapovalov');
 assert.match(snapshot.kalshi[1].link.url,/op_market_ticker=KXATPMATCH-26SEP27MANSHA-SHA/);
 assert.equal(snapshot.polymarket.sides[0].link.url,'https://polymarket.com/event/mannarino-shapovalov');
});
test('game links include only market-matched source contracts, avoid duplicate YES/NO buttons',()=>{
 const eventTicker='KXNCAAFGAME-26SEP26IWTXST';
 const game={sport:'cfb',id:'1234',market:{venueOffers:[
  {source:'Kalshi',sourceMarketId:eventTicker+'-TXST',eventTicker,marketFamily:'moneyline',side:'home'},
  {source:'Kalshi',sourceMarketId:eventTicker+'-TXST',eventTicker,marketFamily:'moneyline',side:'home'},
  {source:'Polymarket US',sourceMarketId:'no-native-url'},
  {source:'PinnOdds',sourceMarketId:'pin-11'}
 ]}};
 const links=exchangeLinksForGame(game);
 assert.equal(links.length,1);
 assert.equal(links[0].provider,'Kalshi');
});
