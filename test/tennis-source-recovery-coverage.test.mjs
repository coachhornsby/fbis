import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/tennis-source-coverage.js';

test('source coverage reports independent sources separately without promotion',async()=>{
 const seen=[];
 const env={DB:{prepare(sql){seen.push(sql);return {async all(){return {results:[]};}};}}};
 const response=await onRequestGet({env});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.ok,true);
 assert.deepEqual(body.externalResearchFixtures,[]);
 assert.deepEqual(body.profileCoverage,[]);
 assert.equal(body.policy.priceSourceIsProjection,false);
 assert.equal(body.policy.sourceCoverageDoesNotAuthorizeWager,true);
 assert.ok(seen.some(s=>s.includes('FROM tennis_external_fixtures')));
 assert.ok(seen.some(s=>s.includes('FROM tennis_official_matches')));
});
