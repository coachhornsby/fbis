import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../.github/workflows/tennis-lowtier-source-recovery.yml',import.meta.url),'utf8');
test('tennis audit waits for authoritative live SHA and verifies Git ancestry',()=>{
 assert.match(source,/VERIFY_MODE=resolve-live/);
 assert.match(source,/for attempt in/);
 assert.match(source,/sleep 20/);
 assert.match(source,/LIVE_PRODUCTION_MISSING_TENNIS_AUDIT_COMMIT_AFTER_BOUNDED_WAIT/);
 assert.match(source,/git merge-base --is-ancestor/);
 assert.match(source,/git cat-file -e/);
 assert.match(source,/LIVE_PRODUCTION_MISSING_TENNIS_AUDIT_COMMIT/);
 assert.doesNotMatch(source,/deploy.*--force/i);
});
