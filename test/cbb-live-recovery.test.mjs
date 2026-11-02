import test from 'node:test';import assert from 'node:assert/strict';
import{mapSourceTeam}from'../functions/lib/collegeIdentity.js';
import{loadFbisCbbCatalog}from'../functions/lib/cbbFbisRatings.js';
import{resetCacheMem}from'../functions/lib/cache.js';
import{hasVerifiedMatchupInputs}from'../functions/lib/cbbRatingsSafe.js';
import{cbbFbisV2TotalCorrection}from'../functions/lib/cbbFbisV2Total.js';
import{CBB_PRO_VERSION}from'../functions/lib/cbbProModel.js';
import{readFileSync}from'node:fs';
test('Miami basketball IDs cannot cross into football',()=>{assert.equal(mapSourceTeam('cbb',{team:'Miami FL'},2027).canonicalId,'cbb-2390');assert.equal(mapSourceTeam('cbb',{team:'Miami OH'},2027).canonicalId,'cbb-193');assert.equal(mapSourceTeam('cfb',{team:'Miami FL'},2026).canonicalId,'cfb-2390');});
test('CBBD ending year is not incremented again',async()=>{resetCacheMem();let seen;await loadFbisCbbCatalog({CBBD_API_KEY:'offline-test'},{season:2027,fetchFn:async u=>{seen=new URL(u);return Response.json([])}});assert.equal(seen.searchParams.get('season'),'2027');});
test('missing matchup inputs cannot pass as zeros',()=>{assert.equal(hasVerifiedMatchupInputs(Object.fromEntries(['homeEfg','awayEfgDef','awayTov','homeTov','homeOrb','awayOrb','homeFtRate','awayFtRate'].map(k=>[k,null]))),false);assert.equal(cbbFbisV2TotalCorrection({ok:true,total:null}).ok,false);});
test('runtime version agrees with the retained production contract',()=>{assert.equal(CBB_PRO_VERSION,JSON.parse(readFileSync(new URL('../data/models/cbb-pro-v1.json',import.meta.url))).version);});

import {loadCbbCurrentTeamInput} from '../functions/lib/cbbCurrentInputs.js';
test('current CBB input lookup requires the dedicated binding and exact season/team',async()=>{
  assert.equal((await loadCbbCurrentTeamInput({DB:{}} ,{season:2027,teamId:'cbb-150'})).reason,'CBB_DB_UNBOUND');
  let sql,keys;
  const env={CBB_DB:{prepare:q=>{sql=q;return {bind:(...k)=>{keys=k;return {first:async()=>({payload_json:JSON.stringify({season:2027,teamId:'cbb-150',players:[]}),source_sha256:'proof'})}}}}}};
  const result=await loadCbbCurrentTeamInput(env,{season:2027,teamId:'cbb-150'});
  assert.deepEqual(keys,[2027,'cbb-150']);assert.match(sql,/WHERE season=\? AND team_id=\?/);
  assert.equal(result.ok,true);assert.equal(result.projectionReady,false);assert.equal(result.automaticWagerAuthorization,false);
  assert.equal((await loadCbbCurrentTeamInput(env,{season:2027,teamId:'cfb-150'})).reason,'INVALID_CBB_INPUT_KEY');
});
