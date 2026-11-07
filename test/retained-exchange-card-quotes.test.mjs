import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {matchedKalshiCardQuotes,kalshiUnavailableMarkets} from '../functions/lib/exchangeCardDelivery.js';
const capture=JSON.parse(readFileSync(new URL('./fixtures/kalshi-texas-missouri-captured-20261107.json',import.meta.url),'utf8'));
const fixtures=[{id:'test-texas-missouri',sport:'cfb',home_name:'Missouri Tigers',away_name:'Texas Longhorns',start:'2026-11-07T17:00:00Z'}];
const snapshot={ok:true,sport:'cfb',seriesTicker:'KXNCAAFGAME',capturedAt:capture.sourceCapturedAt,records:capture.records};
const now=Date.parse(capture.readAt),options={sport:'cfb',now,retainLastObserved:true};
const result=(s=snapshot,ws=null)=>matchedKalshiCardQuotes(fixtures,s,ws,options);
test('explicit display retention preserves old fetched lines without changing strict defaults',()=>{
 assert.deepEqual(matchedKalshiCardQuotes(fixtures,snapshot,null,{sport:'cfb',now}),{});
 const q=result()['test-texas-missouri'];assert.equal(q.length,2);
 assert.ok(q.every(x=>x.stale&&x.quoteAgeSeconds>900&&x.referenceOnly&&x.canQualify===false&&x.canRecommend===false&&x.executionEligible===false&&x.canAuthorizeWager===false));
 assert.equal(q[0].receivedAt,capture.records[0].fetchedAt);assert.equal(q[0].ask,.57);assert.equal(q[0].sourceObservedAt,null);
 assert.equal(q[0].eventTicker,'KXNCAAFGAME-26NOV07TEXMIZZ');
});
test('older WebSocket arrival never overwrites newer REST observation',()=>{
 const ws={capturedAt:snapshot.capturedAt,quotes:[{ticker:capture.records[0].ticker,yesAsk:.99,receivedAt:new Date(Date.parse(capture.records[0].fetchedAt)-1000).toISOString()}]};
 assert.equal(result(snapshot,ws)['test-texas-missouri'][0].ask,.57);
});
test('newest known WebSocket observation replaces REST even when both age out',()=>{
 const receivedAt=new Date(Date.parse(capture.records[0].fetchedAt)+1000).toISOString();
 const ws={capturedAt:snapshot.capturedAt,quotes:[{ticker:capture.records[0].ticker,yesAsk:.58,receivedAt,sourceObservedAt:receivedAt},{ticker:capture.records[0].ticker,yesAsk:.90,receivedAt:capture.records[0].fetchedAt}]};
 const q=result(snapshot,ws)['test-texas-missouri'][0];assert.equal(q.ask,.58);assert.equal(q.stale,true);assert.equal(q.receivedAt,receivedAt);assert.equal(q.sourceObservedAt,receivedAt);
});
test('closed and invalid observed markets produce timestamped invalidations',()=>{
 const closed={...snapshot,records:snapshot.records.map(x=>({...x,status:'closed'}))};
 assert.deepEqual(result(closed),{});const invalidations=kalshiUnavailableMarkets([closed],null,{now});assert.equal(invalidations.length,2);assert.ok(invalidations.every(x=>x.marketStatus==='closed'&&x.receivedAt===capture.records[0].fetchedAt));
 assert.equal(kalshiUnavailableMarkets([{...snapshot,records:[{...capture.records[0],yesAskDollars:null}]}],null,{now})[0].marketStatus,'invalid');
});
test('missing partial rows are not invalidations; future and malformed evidence is rejected',()=>{
 assert.deepEqual(kalshiUnavailableMarkets([{...snapshot,records:[]}],null,{now}),[]);
 const future={...snapshot,records:snapshot.records.map(x=>({...x,fetchedAt:new Date(now+1).toISOString()}))};assert.deepEqual(result(future),{});
 assert.deepEqual(result({...snapshot,records:[snapshot.records[0]]}),{});
 assert.deepEqual(result({...snapshot,capturedAt:'bad'}),{});
});

import {matchedKalshiBasketballLineQuotes} from '../functions/lib/kalshiBasketballLineQuotes.js';
import {matchedKalshiCbbFirstHalfTotals} from '../functions/lib/kalshiFirstHalfTotalQuotes.js';
test('basketball line families retain old display quotes only with explicit option',()=>{
 const fixture={id:'cbb',sport:'cbb',home_name:'UCLA Bruins',away_name:'North Florida Ospreys',start:'2026-11-07T03:30:00Z'},fetchedAt=new Date(now-3600000).toISOString();
 for(const sourceSport of ['cbb_spread','cbb_total','cbb_team_total']){
  const suffix={cbb_spread:'SPREAD',cbb_total:'TOTAL',cbb_team_total:'TEAMTOTAL'}[sourceSport],series='KXNCAAMB'+suffix;
  const rules={cbb_spread:'If UCLA wins by more than 2.5 points',cbb_total:'If over 150.5 total points are scored',cbb_team_total:'If UCLA scores more than 80.5 points'};
  const m={sport:sourceSport,seriesTicker:series,status:'active',ticker:series+'-EVENT-X',eventTicker:series+'-EVENT',fetchedAt,yesAskDollars:.5,noAskDollars:.51,rulesPrimary:rules[sourceSport]+" in the North Florida vs UCLA men's college basketball game originally scheduled for Nov 6, 2026, then the market resolves to Yes."};
  const s={ok:true,sport:sourceSport,seriesTicker:series,capturedAt:fetchedAt,records:[m]};
  assert.deepEqual(matchedKalshiBasketballLineQuotes([fixture],s,{sourceSport,now}),{});
  const out=matchedKalshiBasketballLineQuotes([fixture],s,{sourceSport,now,retainLastObserved:true}).cbb;
  assert.equal(out.length,2);assert.ok(out.every(q=>q.stale&&q.receivedAt===fetchedAt&&q.canQualify===false));
 }
 const m={sport:'cbb_1h_total',seriesTicker:'KXNCAAMB1HTOTAL',status:'active',ticker:'KXNCAAMB1HTOTAL-EVENT-X',eventTicker:'KXNCAAMB1HTOTAL-EVENT',fetchedAt,yesAskDollars:.5,noAskDollars:.51,rulesPrimary:"If over 70.5 total points are scored in the 1st half of the North Florida vs UCLA men's college basketball game originally scheduled for Nov 6, 2026, then the market resolves to Yes."};
 const s={ok:true,sport:m.sport,seriesTicker:m.seriesTicker,capturedAt:fetchedAt,records:[m]};
 assert.deepEqual(matchedKalshiCbbFirstHalfTotals([fixture],s,{now}),{});
 assert.ok(matchedKalshiCbbFirstHalfTotals([fixture],s,{now,retainLastObserved:true}).cbb.every(q=>q.stale&&q.canQualify===false));
});
test('invalid newer provider clock invalidates retained WS references; REST cannot exceed snapshot clock',()=>{
 const at=new Date(now-1000).toISOString(),ws={capturedAt:new Date(now).toISOString(),quotes:[{ticker:capture.records[0].ticker,yesAsk:.6,receivedAt:at,sourceObservedAt:'bad'}]};
 assert.equal(kalshiUnavailableMarkets([snapshot],ws,{now})[0].marketStatus,'invalid');
 ws.quotes[0].sourceObservedAt=new Date(now).toISOString();assert.equal(kalshiUnavailableMarkets([snapshot],ws,{now})[0].marketStatus,'invalid');
 const bad={...snapshot,records:snapshot.records.map(m=>({...m,fetchedAt:new Date(now-1).toISOString()}))};
 assert.deepEqual(result(bad),{});assert.deepEqual(kalshiUnavailableMarkets([{...bad,records:bad.records.map(m=>({...m,status:'closed'}))}],null,{now}),[]);
});
