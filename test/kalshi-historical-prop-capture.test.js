import test from 'node:test';
import assert from 'node:assert/strict';
import {captureKalshiPlayerProps,loadCapturedKalshiProps} from '../functions/lib/kalshiPlayerPropCollector.js';

test('pregame capture persists dated inventory; after kickoff never overwrites it',async()=>{
 const store=new Map();
 const put=async(key,value)=>store.set(key,JSON.parse(value));
 const get=async(key)=>store.has(key)?{json:async()=>store.get(key)}:null;
 const series='KXMLBHIT',ticker=series+'-TEST';
 const contract={ticker, rules_primary:'If Brice Turang records 1+ hits in the Tampa Bay vs Milwaukee professional baseball game originally scheduled for Oct 23, 2026 at 8:00 PM EDT, then the market resolves to Yes.',strike_type:'greater',floor_strike:.5};
 store.set('kalshi/public-shadow/v1/series-catalog.json',{ok:true,records:[{ticker:series}]});
 const env={ARCHIVE:{get,put}};
 const response=async()=>({ok:true,json:async()=>({markets:[contract],cursor:''})});
 const before=new Date('2026-10-23T22:00:00Z');
 const first=await captureKalshiPlayerProps(env,{now:before,fetchImpl:response,maxSeries:1});
 assert.equal(first.ok,true);
 const key='player-props/kalshi/v1/history/2026-10-23/KXMLBHIT.json';
 assert.equal(store.get(key).records.length,1);
 assert.equal(store.get(key).capturedAt,before.toISOString());
 store.delete('player-props/kalshi/v1/status.json');
 const after=new Date('2026-10-24T01:00:00Z');
 await captureKalshiPlayerProps(env,{now:after,fetchImpl:response,maxSeries:1});
 assert.equal(store.get(key).capturedAt,before.toISOString());
 const loaded=await loadCapturedKalshiProps(env,{sport:'mlb',date:'2026-10-23',now:Date.parse('2026-10-24T06:00:00Z'),games:[],players:[],seriesFilter:series});
 assert.equal(loaded.coverage[0].historical,true);
 assert.equal(loaded.coverage[0].records,1);
});
