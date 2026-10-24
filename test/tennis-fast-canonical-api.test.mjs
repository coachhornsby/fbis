import test from 'node:test';
import assert from 'node:assert/strict';
import {readTennisFastCanonical} from '../functions/api/tennis-fast-data.js';
const row={match_id:'atp-1',tour:'atp',source:'ATP_OFFICIAL',
 completion_state:'FINAL',result_reason:'OFFICIAL_COMPLETED_SETS',
 raw_artifact_key:'tennis/atp/official-results/raw/1.json',
 winner_id:'a',source_winner_id:'a',player1_id:'a',player2_id:'b',
 match_time:'2026-10-20T10:00:00Z',observed_at:'2026-10-20T14:00:00Z',surface:'hard'};
const fake=(count,rows)=>({prepare:sql=>({bind:()=>({
 first:async()=>({n:count,latest_match:row.match_time,latest_observation:row.observed_at}),
 all:async()=>({results:rows})
})})});
test('canonical adapter uses true persisted verified rows and exposes audit flags',async()=>{
 const result=await readTennisFastCanonical(fake(1,[row]),{tour:'atp',asOf:'2026-10-23T10:00:00Z'});
 assert.equal(result.rows.length,1);
 assert.equal(result.coverage.canonicalVerified,1);
 assert.equal(result.coverage.statCompletenessVerified,false);
});
test('mismatched counts and oversized reads fail closed',async()=>{
 await assert.rejects(readTennisFastCanonical(fake(2,[row]),{tour:'atp',asOf:'2026-10-23T10:00:00Z'}),/INCOMPLETE/);
 await assert.rejects(readTennisFastCanonical(fake(2,[row]),{tour:'atp',asOf:'2026-10-23T10:00:00Z',maxRows:1}),/EXCEED/);
});
