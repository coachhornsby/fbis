import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requirePinnoddsMarketHistoryHeadroom,PINNODDS_Q4_WRITE_CUTOFF} from '../scripts/lib/pinnoddsCapacityPreflight.mjs';

const report=(bytes,limit=10_000_000_000)=>({ok:true,marketHistoryQ4:{usedBytes:bytes,hardLimitBytes:limit}});

test('PinnOdds rejects Q4 at or above the existing 85% write guard before provider reservation',()=>{
  assert.equal(PINNODDS_Q4_WRITE_CUTOFF,0.85);
  for(const bytes of [8_500_000_000,9_109_897_216,10_000_000_000])
    assert.throws(()=>requirePinnoddsMarketHistoryHeadroom(report(bytes)),/NO_PROVIDER_CALL/);
});
test('PinnOdds rejects unknown, missing, malformed and non-positive capacity metadata',()=>{
  for(const bad of [null,{}, {ok:false}, {ok:true}, report(NaN),report(-1),report(1,0),report(1,NaN)])
    assert.throws(()=>requirePinnoddsMarketHistoryHeadroom(bad),/UNVERIFIED_FAIL_CLOSED/);
});
test('PinnOdds allows a verified under-85% Q4 and reports exact measured bytes',()=>{
  assert.deepEqual(requirePinnoddsMarketHistoryHeadroom(report(8_499_999_999)),{
    databaseKey:'MARKET_HISTORY_2026Q4',usedBytes:8_499_999_999,hardLimitBytes:10_000_000_000,percentUsed:84.99999999
  });
});
test('capacity preflight precedes the quota-reserving PinnOdds API call',()=>{
  const source=readFileSync(new URL('../scripts/collect-pinnodds-governed.mjs',import.meta.url),'utf8');
  const preflight=source.indexOf('requirePinnoddsMarketHistoryHeadroom(capacity)');
  const reserve=source.indexOf("operation:'reserve'");
  assert.ok(preflight>=0&&reserve>preflight,'provider reservation must follow verified capacity preflight');
});
