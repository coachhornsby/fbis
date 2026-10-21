import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTennisProjectionCoverage} from '../functions/lib/tennisProjectionPipeline.js';

test('fixture coverage joins only PURE_FIXTURE decision rows',async()=>{
 let query=null;
 const db={prepare(sql){query=sql;return {bind(){return {async all(){return {results:[]};}};}};}};
 const coverage=await inspectTennisProjectionCoverage(db,{now:new Date('2026-10-21T16:00:00Z')});
 assert.match(query,/canonical_event_id=m\.match_id AND snapshot_type='PURE_FIXTURE'/);
 assert.equal(coverage.successfulProjections,0);
 assert.equal(coverage.canAuthorizeWager,false);
});
