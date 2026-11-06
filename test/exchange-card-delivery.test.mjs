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
