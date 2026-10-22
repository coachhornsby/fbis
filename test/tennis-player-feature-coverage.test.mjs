import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {onRequestGet} from '../functions/api/tennis-player-feature-coverage.js';
const refresh=readFileSync(new URL('../scripts/tennis-v2-profile-refresh.mjs',import.meta.url),'utf8');
test('destructive profile refresh fails closed when any tour/year feed fails',()=>{
 assert.match(refresh,/TENNIS_PROFILE_SOURCE_INCOMPLETE_/);
 assert.match(refresh,/sourceReceipts\[tour\]\.add\(year\)/);
 assert.match(refresh,/TENNIS_PROFILE_EMPTY_TOUR_/);
 assert.ok(refresh.indexOf('TENNIS_PROFILE_SOURCE_INCOMPLETE_')<refresh.indexOf('DELETE FROM tennis_player_profiles_current'));
});
test('profile audit is authenticated, with no private information returned unauthenticated',async()=>{
 const response=await onRequestGet({request:new Request('https://example.test/api/tennis-player-feature-coverage'),env:{HARVEST_SECRET:'a'.repeat(32)}});
 assert.equal(response.status,403);
});
