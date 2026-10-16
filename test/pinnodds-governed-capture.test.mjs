import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reservePinnoddsRun,capturePinnoddsSnapshot,requireProjectedPaidScope,MAX_PINNODDS_USD_PER_PAID_PULL
} from '../workers/pinnodds-governed-capture.mjs';

test('PinnOdds hard ceiling is seventy cents',()=>{
  assert.equal(MAX_PINNODDS_USD_PER_PAID_PULL,0.70);
  assert.deepEqual(requireProjectedPaidScope({
    kind:'prematch_event',canonicalEventId:'fbis-id',providerEventId:'provider-id',costUsd:0.70
  }).allowed,true);
  assert.throws(()=>requireProjectedPaidScope({
    kind:'prematch_event',canonicalEventId:'fbis-id',providerEventId:'provider-id',costUsd:0.71
  }),/OVER_70_CENTS/);
  assert.throws(()=>requireProjectedPaidScope({
    kind:'prematch_event',canonicalEventId:'fbis-id',providerEventId:'provider-id'
  }),/USD_COST_UNVERIFIED/);
});
test('sport-wide boards, drop buffers and unscoped calls cannot be charged',()=>{
  for(const kind of ['board','drops','health','full','unknown']){
    assert.throws(()=>requireProjectedPaidScope({kind,canonicalEventId:'f',providerEventId:'p',costUsd:0}),/PROJECTION_ONLY_EVENT_SCOPE_REQUIRED/);
  }
  assert.throws(()=>requireProjectedPaidScope({kind:'live_event',costUsd:0}),/PROJECTION_ONLY_EVENT_SCOPE_REQUIRED/);
});
test('PinnOdds legacy reserve stops before contacting account or provider',async()=>{
  let network=0;
  const fetchImpl=async()=>{network++;throw Error('UNEXPECTED_EXTERNAL_CALL');};
  for(const scope of ['full','drops']){
    await assert.rejects(reservePinnoddsRun({}, {runId:'blocked',scope,fetchImpl}),/PROJECTION_ONLY_EVENT_SCOPE_REQUIRED/);
  }
  assert.equal(network,0);
});
test('PinnOdds legacy capture cannot make chargeable provider calls',async()=>{
  let network=0;
  const fetchImpl=async()=>{network++;throw Error('UNEXPECTED_EXTERNAL_CALL');};
  for(const kind of ['board','drops','health']){
    await assert.rejects(capturePinnoddsSnapshot({}, {runId:'blocked',kind,feed:'prematch',sportId:6,fetchImpl}),/PROJECTION_ONLY_EVENT_SCOPE_REQUIRED/);
  }
  assert.equal(network,0);
});
