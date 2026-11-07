import test from 'node:test';
import assert from 'node:assert/strict';
import {kalshiTickerObservedAt as observed} from '../services/kalshi-public-collector/tickerTimestamp.mjs';
const now=1794014400000;
test('documented update milliseconds preserve source time, including stale updates',()=>{
 assert.equal(observed({ts_ms:now-1000},now),new Date(now-1000).toISOString());
 assert.equal(observed({ts_ms:now-86400000},now),new Date(now-86400000).toISOString());
});
test('receive, queue, metadata and deprecated clocks cannot manufacture provenance',()=>{
 for(const value of [{},{sending_ts_ms:now},{ts:now/1000},{time:new Date(now).toISOString()},{updated_time:new Date(now).toISOString()}])assert.equal(observed(value,now),null);
});
test('reject ambiguous units, invalid values and future update clocks',()=>{
 for(const ts_ms of [null,'1794014400000',now/1000,now+1,Infinity,NaN,-1,now-0.5])assert.equal(observed({ts_ms},now),null);
 assert.equal(observed({ts_ms:now},NaN),null);
});
