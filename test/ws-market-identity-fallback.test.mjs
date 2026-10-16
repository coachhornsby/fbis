import test from 'node:test';
import assert from 'node:assert/strict';
import {latestPublicMarkets} from '../functions/api/polymarket-ws-capture.js';

function mock(results){
 const calls=[];return {calls,prepare(sql){
  assert.match(sql,/source='Polymarket US'/);
  assert.match(sql,/event_start_time>=\?2/);
  return {bind(...args){calls.push(args);return {async all(){return {results:results[calls.length-1]||[]}}}}}
 }};
}
test('recent directory observations win without any stale fallback',async()=>{
 const recent={source_market_id:'future-1',canonical_event_id:'game1'};
 const db=mock([[recent]]);
 assert.deepEqual(await latestPublicMarkets(db),[recent]);
 assert.equal(db.calls.length,1);
 const now=Date.now();
 assert.ok(Date.parse(db.calls[0][0])>=now-24*3600000-4000);
 assert.ok(Date.parse(db.calls[0][1])>=now+30*60000-4000);
});
test('stale directory fallback is limited to 72h old metadata for future-starting games',async()=>{
 const fallback={source_market_id:'future-2',canonical_event_id:'game2'};
 const db=mock([[],[fallback]]);
 assert.deepEqual(await latestPublicMarkets(db),[fallback]);
 assert.equal(db.calls.length,2);
 const now=Date.now();
 assert.ok(Math.abs(Date.parse(db.calls[1][0])-(now-72*3600000))<4000);
 assert.ok(Date.parse(db.calls[1][1])>=now+30*60000-4000);
 assert.equal(db.calls[0][2],8);assert.equal(db.calls[1][2],8);
});
test('no directory candidates remains closed; never synthesize prices',async()=>{
 const db=mock([[],[]]);assert.deepEqual(await latestPublicMarkets(db),[]);
 assert.equal(db.calls.length,2);
});
