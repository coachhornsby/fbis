import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reservePinnoddsRun,capturePinnoddsSnapshot,requireProjectedFreeScope,
  verifyPinnoddsFreeTrial,PINNODDS_TRIAL_REST_COST_USD,PINNODDS_TRIAL_DOCUMENTED_LIMITS
} from '../workers/pinnodds-governed-capture.mjs';

test('PinnOdds free REST tier is zero dollars and rate-limited by requests',()=>{
 assert.equal(PINNODDS_TRIAL_REST_COST_USD,0);
 assert.deepEqual(PINNODDS_TRIAL_DOCUMENTED_LIMITS,{perDay:100,perMinute:20});
 const proof=verifyPinnoddsFreeTrial({plan:{id:'trial',limits:{perDay:100,perMin:20}}});
 assert.equal(proof.perRequestUsd,0);
 assert.equal(proof.limits.perDay,100);
 assert.throws(()=>verifyPinnoddsFreeTrial({plan:{id:'pro',limits:{perDay:100,perMin:20}}}),/FREE_PLAN_NOT_VERIFIED/);
 assert.throws(()=>verifyPinnoddsFreeTrial({plan:{id:'trial'}}),/FREE_QUOTA_NOT_VERIFIED/);
});
test('exact projected-event scope is required; no artificial seventy-cent dollar test',()=>{
 const result=requireProjectedFreeScope({
   kind:'prematch_event',canonicalEventId:'fbis-id',providerEventId:'1629513753'
 });
 assert.deepEqual(result,{allowed:true,canonicalEventId:'fbis-id',providerEventId:'1629513753',costUsd:0});
 assert.equal(requireProjectedFreeScope({kind:'live_event',canonicalEventId:'game',providerEventId:123}).allowed,true);
 assert.throws(()=>requireProjectedFreeScope({
   kind:'prematch_event',canonicalEventId:'fbis-id',providerEventId:'unverified'
 }),/PROJECTION_ONLY_EVENT_SCOPE_REQUIRED/);
});
test('sport-wide boards, drop buffers and unscoped calls cannot bypass projection rule',()=>{
 for(const kind of ['board','drops','health','full','unknown']){
  assert.throws(()=>requireProjectedFreeScope({kind,canonicalEventId:'f',providerEventId:'123'}),/PROJECTION_ONLY_EVENT_SCOPE_REQUIRED/);
 }
 assert.throws(()=>requireProjectedFreeScope({kind:'live_event',providerEventId:'123'}),/PROJECTION_ONLY_EVENT_SCOPE_REQUIRED/);
});
test('legacy reserve stops before consuming free request quota',async()=>{
 let network=0;
 const fetchImpl=async()=>{network++;throw Error('UNEXPECTED_EXTERNAL_CALL');};
 for(const scope of ['full','drops']){
  await assert.rejects(reservePinnoddsRun({}, {runId:'blocked',scope,fetchImpl}),/PROJECTION_ONLY_EVENT_SCOPE_REQUIRED/);
 }
 assert.equal(network,0);
});
test('legacy broad capture cannot contact the free provider',async()=>{
 let network=0;
 const fetchImpl=async()=>{network++;throw Error('UNEXPECTED_EXTERNAL_CALL');};
 for(const kind of ['board','drops','health']){
  await assert.rejects(capturePinnoddsSnapshot({}, {runId:'blocked',kind,feed:'prematch',sportId:6,fetchImpl}),/PROJECTION_ONLY_EVENT_SCOPE_REQUIRED/);
 }
 assert.equal(network,0);
});
