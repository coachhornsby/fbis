import test from 'node:test';import assert from 'node:assert/strict';
import {buildNhlOfficialScopeCandidates} from '../functions/lib/nhlPropScopeCandidates.js';
const row={sport:'nhl',provider:'Kalshi',identityVerified:true,canonicalEventId:'2025020001',
 canonicalPlayerId:'nhl:nhl:8478402',historyPlayerId:'8478402',canonical_market:'shots_on_goal',
 period:'full_game',contractId:'KXNHLSOG-1',providerEventId:'event1',providerPlayerId:'athlete1',
 start_time:'2026-10-20T22:00:00Z'};
test('matched contract produces only review-required candidate, never certified collector scope',()=>{
 const r=buildNhlOfficialScopeCandidates([row,row],{capturedAt:'2026-10-20T11:00:00Z'});
 assert.equal(r.scopes.length,1);assert.equal(r.certified,false);
 assert.equal(r.scopes[0].identityVerified,false);assert.equal(r.scopes[0].reviewRequired,true);
 assert.equal(r.canAuthorizeWager,false);
});
test('rejects post-start, fuzzy identity, unsupported stat and non-prospective snapshots',()=>{
 for(const bad of [{...row,canonicalPlayerId:'nhl:nhl:other'},{...row,canonicalEventId:'evt1'},
  {...row,canonical_market:'fantasy_points'},{...row,identityVerified:false}]){
  const r=buildNhlOfficialScopeCandidates([bad],{capturedAt:'2026-10-20T11:00:00Z'});
  assert.equal(r.scopes.length,0);assert.equal(r.rejected.length,1);
 }
 assert.equal(buildNhlOfficialScopeCandidates([row],{capturedAt:'2026-10-21T00:00:00Z'}).scopes.length,0);
});
