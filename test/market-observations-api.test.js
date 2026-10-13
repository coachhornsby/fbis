import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/market-observations.js';
test('event market pagination exposes continuation and preserves unknown provider time',async()=>{
 const at=new Date().toISOString(),records=Array.from({length:101},(_,i)=>({id:'row'+i,source:'Polymarket US',sport:'mlb',canonical_event_id:'event',source_market_id:'market'+i,source_outcome_id:'yes',contract_price:0.6,collected_at:at,source_observed_at:at,raw_payload_json:'{"sourceObservedAt":null}'}));
 const env={DB:{prepare(sql){assert.match(sql,/source_outcome_id,period,side,line/);return{bind(...args){assert.deepEqual(args,['mlb','event',101,0]);return{async all(){return{results:records}}}}}}}};
 const result=await (await onRequestGet({env,request:new Request('https://fbis.test/api/market-observations?sport=mlb&eventId=event')})).json();
 assert.equal(result.rows.length,100);assert.equal(result.nextCursor,'100');assert.equal(result.rows[0].providerObservedAt,null);assert.equal(result.rows[0].temporal.status,'SOURCE_TIME_UNKNOWN');assert.equal(result.rows[0].canAuthorizeWager,false);
});
test('invalid event scope cannot query the ledger',async()=>{
 const response=await onRequestGet({env:{},request:new Request('https://fbis.test/api/market-observations?sport=bogus&eventId=event')});assert.equal(response.status,400);
});
