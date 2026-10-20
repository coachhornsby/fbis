import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverNhlSourceVerifiedScopes} from '../functions/lib/nhlOfficialScopeDiscovery.js';
test('source discovery cannot approve scopes without official DB and storage bindings',async()=>{
 const a=await discoverNhlSourceVerifiedScopes({},{now:new Date('2026-10-20T12:00:00Z')});
 assert.equal(a.ok,false);assert.equal(a.reason,'SOURCE_BINDINGS_MISSING');
});
test('incomplete primary coverage cannot self-certify a manifest',async()=>{
 const written=[];
 const env={DB:{prepare:()=>({bind:()=>({all:async()=>{throw Error('unavailable')}})})},
  ARCHIVE:{get:async()=>null,put:async(k,v)=>written.push(k)}};
 const a=await discoverNhlSourceVerifiedScopes(env,{now:new Date('2026-10-20T12:00:00Z')});
 assert.equal(a.ok,false);assert.equal(a.reason,'CANONICAL_FIXTURE_OR_ROSTER_COVERAGE_FAILED');
 assert.equal(written.length,0);
});
