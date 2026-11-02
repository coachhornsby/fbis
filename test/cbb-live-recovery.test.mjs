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

import {loadCbbCurrentProviderInput}from'../functions/lib/cbbCurrentProviderInputs.js';
test('provider snapshots require a dedicated exact source/season/team key',async()=>{
 assert.equal((await loadCbbCurrentProviderInput({DB:{}},{season:2027,provider:'torvik',teamId:'cbb-150'})).reason,'CBB_DB_UNBOUND');
 let keys;const env={CBB_DB:{prepare:sql=>{assert.match(sql,/WHERE season=\? AND provider=\? AND team_id=\?/);return{bind:(...args)=>{keys=args;return{first:async()=>({payload_json:JSON.stringify({season:2027,canonicalId:'cbb-150'}),source_sha256:'proof',capture_run_id:'offline'})}}}}}};
 const r=await loadCbbCurrentProviderInput(env,{season:2027,provider:'torvik',teamId:'cbb-150'});assert.equal(r.ok,true);assert.deepEqual(keys,[2027,'torvik','cbb-150']);assert.equal(r.projectionReady,false);assert.equal(r.canAuthorizeWager,false);
 assert.equal((await loadCbbCurrentProviderInput(env,{season:2027,provider:'unknown',teamId:'cbb-150'})).reason,'INVALID_PROVIDER_INPUT_KEY');
});
test('native ratings refuse a provider-sized cap rather than fitting an unproven season',async()=>{resetCacheMem();const x=await loadFbisCbbCatalog({CBBD_API_KEY:'offline-test'},{season:2027,fetchFn:async()=>Response.json(Array.from({length:3000},()=>({season:2027})))});assert.equal(x.ok,false);assert.equal(x.error,'CBBD_GAME_TEAM_COMPLETENESS_UNPROVEN');});

import{normalizeKenpomRatingRows,mergeKenpomTeamInputs}from'../functions/lib/kenpomCbb.js';
test('KenPom zero-game placeholders cannot masquerade as observed matchup statistics',()=>{
 const ratings=normalizeKenpomRatingRows([{TeamName:'Duke',Season:2027,Wins:0,Losses:0,AdjOE:125,AdjDE:95,AdjTempo:70}]);
 const [row]=mergeKenpomTeamInputs(ratings,[{team:'Duke',efgPct:0,tovRate:1,orbRate:0,ftr:0}],[{team:'Duke',pointsFromFt:0}],[{team:'Duke',experience:2.5,continuity:.3}],[]);
 assert.equal(row.adjOe,125);assert.equal(row.tempo,70);assert.equal(row.gamesPlayed,0);assert.equal(row.observedBoxScoreStats,false);assert.equal(row.tovRate,null);assert.equal(row.pointsFromFt,null);assert.equal(row.experience,2.5);
});
