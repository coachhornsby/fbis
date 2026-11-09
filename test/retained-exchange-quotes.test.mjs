import test from 'node:test';import assert from 'node:assert/strict';
import {mergeRetainedExchangeQuotes as merge,loadRetainedExchangeQuotes as load,saveRetainedExchangeQuotes as save} from '../src/lib/retainedExchangeQuotes.js';
const now=Date.parse('2026-11-07T06:00:00Z');
const q=(offset=0,ask=.57)=>({venue:'Kalshi',marketId:'KXNCAAFGAME-26NOV07TEXMIZZ-TEX',marketFamily:'moneyline',side:'away',ask,eventStart:'2026-11-07T17:00:00Z',receivedAt:new Date(now+offset).toISOString()});
const storage=()=>{const m=new Map();return {get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('newer quotes replace previous, older or future arrivals cannot',()=>{
 const p=merge({}, {game:[q(-60000)]},now);
 const n=merge(p,{game:[q(-30000,.6)]},now);assert.equal(n.game[0].ask,.6);
 assert.equal(merge(n,{game:[q(-60000,.5)]},now).game[0].ask,.6);
 assert.equal(merge(n,{game:[q(1,.9)]},now).game[0].ask,.6);
 assert.equal(n.game[0].canAuthorizeWager,false);assert.equal(n.game[0].executionEligible,false);
});
test('missing partial rows and failed/empty updates retain prices with original timestamps',()=>{
 const p=merge({}, {game:[q(-60000)]},now),n=merge(p,{game:[]},now);
 assert.equal(n.game[0].receivedAt,p.game[0].receivedAt);assert.equal(merge(n,{},now).game[0].ask,.57);
});
test('global tombstones invalidate prior prices and block delayed resurrection',()=>{
 let p=merge({}, {game:[q(-60000)]},now);
 const tomb={venue:'Kalshi',marketId:q().marketId,receivedAt:new Date(now-10000).toISOString(),marketStatus:'closed'};
 p=merge(p,{},now,[tomb]);assert.equal(p.game[0].marketStatus,'closed');
 p=merge(p,{game:[q(-20000,.8)]},now);assert.equal(p.game[0].marketStatus,'closed');
 p=merge(p,{game:[q(0,.61)]},now);assert.equal(p.game[0].ask,.61);assert.notEqual(p.game[0].marketStatus,'closed');
});
test('unknown tombstone survives until a delayed first quote arrives',()=>{
 const p=merge({}, {},now,[{venue:'Kalshi',marketId:q().marketId,receivedAt:new Date(now).toISOString(),marketStatus:'invalid'}]);
 assert.equal(merge(p,{game:[q(-1000)]},now).game[0].marketStatus,'invalid');
});
test('tab cache reload preserves lines and tombstones without action authority',()=>{
 const s=storage(),p=merge({}, {game:[q(-60000)]},now,[{venue:'Kalshi',marketId:q().marketId,receivedAt:new Date(now-10000).toISOString(),marketStatus:'closed'}]);
 assert.equal(save(s,'cfb|2026-11-07',p,now),true);const r=load(s,'cfb|2026-11-07',now);
 assert.equal(r.game[0].marketStatus,'closed');assert.equal(r.game[0].canAuthorizeWager,false);assert.equal(merge(r,{game:[q(-20000)]},now).game[0].marketStatus,'closed');assert.deepEqual(load(s,'nba|2026-11-07',now),{});
});
test('cache tolerates unavailable storage and rejects malformed or oversized content',()=>{
 assert.deepEqual(load({getItem(){throw Error('blocked')}},'cfb|2026-11-07',now),{});assert.equal(save(null,'cfb|2026-11-07',{},now),false);
 assert.deepEqual(load({getItem:()=>'{bad'},'cfb|2026-11-07',now),{});assert.deepEqual(load({getItem:()=> 'x'.repeat(1048577)},'cfb|2026-11-07',now),{});
});
test('cache count stays bounded and saved prices never become verified model inputs',()=>{
 const s=storage();for(let i=1;i<=8;i++)save(s,'cfb|2026-11-'+String(i).padStart(2,'0'),merge({}, {g:[q(-1)]},now),now+i);
 assert.equal(s.length,6);const r=load(s,'cfb|2026-11-08',now);assert.equal(r.g[0].referenceOnly,true);assert.equal(r.g[0].canQualify,false);
});

test('invalid tombstone disables a saved explorer price and exact-market link',async()=>{
 const {exchangeGameMarkets}=await import('../src/lib/exchangeMarketExplorer.js');
 const byEvent=merge({}, {game:[{...q(-60000),eventTicker:'KXNCAAFGAME-26NOV07TEXMIZZ'}]},now,[{venue:'Kalshi',marketId:q().marketId,receivedAt:new Date(now).toISOString(),marketStatus:'invalid'}]);
 const rows=exchangeGameMarkets({ok:true,referenceOnly:true,canAuthorizeWager:false,byEvent},{id:'game'},{now});
 assert.equal(rows.length,1);assert.equal(rows[0].status,'UNAVAILABLE');assert.equal(rows[0].cost,null);assert.equal(rows[0].link,null);assert.equal(rows[0].canAuthorizeWager,false);
});
test('same timestamp price cannot revive closed state',()=>{
 const p=merge({}, {game:[q(-10000)]},now,[{venue:'Kalshi',marketId:q().marketId,receivedAt:new Date(now-10000).toISOString(),marketStatus:'closed'}]);
 assert.equal(merge(p,{game:[q(-10000,.8)]},now).game[0].marketStatus,'closed');
});

test('identical observation can correct freshness only, preserving all quote facts',()=>{
 const old={...q(-180000),transport:'REST',sourceObservedAt:null,stale:true,fresh:false};
 const p=merge({}, {game:[old]},now),incoming={...old,stale:false,fresh:true,marketUrl:'https://changed.invalid',canAuthorizeWager:true};
 const next=merge(p,{game:[incoming]},now).game[0];assert.equal(next.stale,false);assert.equal(next.fresh,true);assert.equal(next.marketUrl,undefined);assert.equal(next.receivedAt,old.receivedAt);assert.equal(next.sourceObservedAt,null);assert.equal(next.canAuthorizeWager,false);
 for(const changes of [{ask:.58},{line:1},{sourceOutcomeId:'changed'},{receivedAt:new Date(now-180001).toISOString()},{sourceObservedAt:new Date(now-190000).toISOString()},{transport:'WebSocket'},{quoteKind:'changed'}]){
  const result=merge(p,{game:[{...incoming,...changes}]},now).game[0];assert.equal(result.stale,true);assert.equal(result.ask,old.ask);
 }
});
test('same-time freshness correction never resurrects a closed contract or tombstone',()=>{
 const old={...q(-180000),stale:true},incoming={...old,stale:false,fresh:true};
 const closed=merge({}, {game:[{...old,marketStatus:'closed'}]},now);
 assert.equal(merge(closed,{game:[incoming]},now).game[0].marketStatus,'closed');
 const tomb={venue:old.venue,marketId:old.marketId,receivedAt:old.receivedAt,marketStatus:'closed'};
 const p=merge({}, {game:[old]},now,[tomb]);assert.equal(merge(p,{game:[incoming]},now).game[0].marketStatus,'closed');
});
