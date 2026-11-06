import test from 'node:test';import assert from 'node:assert/strict';
import {matchedKalshiCardQuotes} from '../functions/lib/exchangeCardDelivery.js';
import {onRequestGet} from '../deploy/board/functions/api/public/exchange-quotes.js';
const now=Date.parse('2026-11-06T16:00:00Z'),start='2026-11-07T01:00:00Z';
const fixtures=[{id:'401',home_name:'Boston Celtics',away_name:'New York Knicks',start}];
const market={sport:'nba',seriesTicker:'KXNBAGAME',ticker:'KXNBAGAME-26NOV06NYKBOS-BOS',status:'active',occurrenceAt:start,title:'New York Knicks at Boston Celtics',yesLabel:'Boston Celtics',yesAskDollars:.52,fetchedAt:new Date(now-300000).toISOString()};
const snapshot={ok:true,sport:'nba',seriesTicker:'KXNBAGAME',capturedAt:new Date(now).toISOString(),records:[market]};
test('joins current WebSocket ask to exact independently matched game, otherwise labels REST',()=>{
 const stream={capturedAt:new Date(now).toISOString(),quotes:[{ticker:market.ticker,yesAsk:.55,receivedAt:new Date(now-1000).toISOString()}]};
 const live=matchedKalshiCardQuotes(fixtures,snapshot,stream,{sport:'nba',now});assert.equal(live['401'][0].ask,.55);assert.equal(live['401'][0].transport,'WebSocket');assert.equal(live['401'][0].canAuthorizeWager,false);
 stream.quotes[0].receivedAt=new Date(now-121000).toISOString();const rest=matchedKalshiCardQuotes(fixtures,snapshot,stream,{sport:'nba',now});assert.equal(rest['401'][0].ask,.52);assert.equal(rest['401'][0].transport,'REST');
});
test('ambiguous teams, different kickoff, expired price and expiration-only metadata never join',()=>{
 for(const m of [{...market,title:'Boston Celtics win?'},{...market,occurrenceAt:null,expectedExpirationAt:start},{...market,occurrenceAt:'2026-11-08T01:00:00Z'},{...market,fetchedAt:new Date(now-901000).toISOString()}])assert.deepEqual(matchedKalshiCardQuotes(fixtures,{...snapshot,records:[m]},null,{sport:'nba',now}),{});
 assert.deepEqual(matchedKalshiCardQuotes([...fixtures,{...fixtures[0],id:'other'}],snapshot,null,{sport:'nba',now}),{});
});
test('public read fails closed before storage when scope or admission is invalid',async()=>{
 let reads=0;const env={FBIS_PRIVATE_CBB:{get(){reads++;throw Error('NO');}}};
 const request=q=>new Request('https://local/api/public/exchange-quotes?'+q);
 assert.equal((await onRequestGet({request:request('sport=bad&date=2026-11-06'),env})).status,400);
 assert.equal((await onRequestGet({request:request('sport=nba&date=2026-11-06'),env})).status,503);assert.equal(reads,0);
});

test('NBA city labels require exact paired settlement rules, same local game date and explicit team aliases',()=>{
 const g={id:'today',home_name:'Sacramento Kings',away_name:'San Antonio Spurs',home_abbr:'SAC',away_abbr:'SA',start:'2026-11-07T03:00:00Z'};
 const make=(city,suffix)=>({...market,ticker:'KXNBAGAME-26NOV06SASSAC-'+suffix,eventTicker:'KXNBAGAME-26NOV06SASSAC',title:city+' wins',yesLabel:city,occurrenceAt:'2026-11-07T06:00:00Z',rulesPrimary:'If '+city+' wins the San Antonio vs Sacramento Pro Basketball game originally scheduled for Nov 6, 2026, then the market resolves to Yes.'});
 const records=[make('San Antonio','SAS'),make('Sacramento','SAC')],s={...snapshot,records};
 assert.equal(matchedKalshiCardQuotes([g],s,null,{sport:'nba',now}).today.length,2);
 for(const fixtures of [[{...g,start:'2026-11-08T03:00:00Z'}],[{...g,away_abbr:'LAL'}],[g,{...g,id:'duplicate'}]])assert.deepEqual(matchedKalshiCardQuotes(fixtures,s,null,{sport:'nba',now}),{});
 assert.deepEqual(matchedKalshiCardQuotes([g],{...s,records:records.slice(0,1)},null,{sport:'nba',now}),{});
});

test('CBB school names join exact canonical schools with paired published rules, not generic mascots',()=>{
 const g={id:'college',sport:'cbb',home_name:'UCLA Bruins',away_name:'North Florida Ospreys',start:'2026-11-07T03:30:00Z'};
 const make=(name,suffix)=>({...market,sport:'cbb',seriesTicker:'KXNCAAMBGAME',ticker:'KXNCAAMBGAME-26NOV06UNFUCLA-'+suffix,eventTicker:'KXNCAAMBGAME-26NOV06UNFUCLA',title:name+' wins',yesLabel:name,occurrenceAt:'2026-11-07T06:30:00Z',rulesPrimary:'If '+name+" wins the North Florida vs UCLA men's college basketball game originally scheduled for Nov 6, 2026, then the market resolves to Yes."});
 const records=[make('North Florida','UNF'),make('UCLA','UCLA')],s={...snapshot,sport:'cbb',seriesTicker:'KXNCAAMBGAME',paginationComplete:false,records};
 assert.equal(matchedKalshiCardQuotes([g],s,null,{sport:'cbb',now}).college.length,2);
 for(const game of [{...g,start:'2026-11-08T03:30:00Z'},{...g,home_name:'Baylor Bears'},{...g,away_name:'Ospreys'}])assert.deepEqual(matchedKalshiCardQuotes([game],s,null,{sport:'cbb',now}),{});
});

test('card delivery policy permits the exact bounded R2 snapshot fanout without D1',async()=>{
 const {CERTIFIED_EXECUTION_JOBS}=await import('../services/account-budget/executionJobs.mjs');
 const units=CERTIFIED_EXECUTION_JOBS['functions/lib/exchangeCardDelivery.js'].units;
 assert.equal(units.r2Reads,8); // fixture + Kalshi game + Kalshi WS + 3 full-game families + CBB 1H total + Polymarket
 assert.equal(units.d1Queries,0);
 assert.equal(units.r2Writes,0);
 assert.equal(units.requests,0);
});

test('a missing account-budget binding is labeled feed paused, not no market exists',async()=>{
 const response=await onRequestGet({request:new Request('https://local/api/public/exchange-quotes?sport=cbb&date=2026-11-06'),env:{FBIS_PRIVATE_CBB:{get(){throw Error('unexpected read')}}}});
 assert.equal(response.status,503);
 const body=await response.json();
 assert.equal(body.code,'EXCHANGE_FEED_READ_PAUSED');
 assert.deepEqual(body.byEvent,{});
 assert.equal(body.canAuthorizeWager,false);
});
