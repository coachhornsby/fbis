import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNhlSourceDiscoveryOnce} from '../services/kalshi-public-collector/index.js';
test('independent scope discovery skips fresh manifest and uses protected Pages relay otherwise',async()=>{
 const data=new Map();const env={FBIS_KALSHI_RELAY_TOKEN:'z'.repeat(40),
 ARCHIVE:{get:async k=>data.has(k)?{json:async()=>JSON.parse(data.get(k))}:null}};
 const now=new Date('2026-10-20T12:00:00Z');
 let calls=0;const fetchImpl=async (url,req)=>{calls++;assert.match(url,/scope=nhl-official-scope-discovery/);
  assert.equal(req.method,'POST');return {ok:true,json:async()=>({ok:true,status:'VERIFIED'})}};
 assert.equal((await collectNhlSourceDiscoveryOnce(env,{now,fetchImpl})).ok,true);assert.equal(calls,1);
 data.set('player-props/official/v1/nhl-scopes.json',JSON.stringify({generatedBy:'FBIS_NHL_OFFICIAL_SOURCE_VERIFIER',verifiedAt:'2026-10-20T11:45:00Z'}));
 assert.equal((await collectNhlSourceDiscoveryOnce(env,{now,fetchImpl})).status,'NOT_DUE');assert.equal(calls,1);
});
