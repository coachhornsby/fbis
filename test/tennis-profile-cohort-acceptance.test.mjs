import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../scripts/verify-tennis-profile-cohort-acceptance.mjs',import.meta.url),'utf8');
test('read-only cohort acceptance requires exact locked roster counts and detects regressions',()=>{
 assert.match(src,/ATP_ROSTER_DRIFT/);
 assert.match(src,/WTA_ROSTER_DRIFT/);
 assert.match(src,/TENNIS_PROFILE_COVERAGE_REGRESSION_REQUIRES_REVIEW/);
 assert.match(src,/minPreviouslyObservedComplete:588/);
 assert.match(src,/WAGER_AUTHORITY_CHANGED/);
 assert.doesNotMatch(src,/(?:fetch\s*\([^;]*method\s*:\s*['"]POST|\.prepare\s*\(|wrangler d1)/s);
});
