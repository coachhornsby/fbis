import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTennisPrematchProfiles } from '../functions/lib/tennisProjectionPipeline.js';
const now = new Date('2026-10-22T12:00:00Z');
const fixture = { event_start_time: '2026-10-23T18:00:00Z' };
const profile = name => ({
  player_name:name,source_as_of:'2026-10-21T00:00:00Z',
  updated_at:'2026-10-22T10:00:00Z',last_match_date:'2026-10-19',
  source:'HISTORICAL',source_license:'RESEARCH',
  profile_json:JSON.stringify({
    name,historyMatches:120,surfaceMatches:60,
    servePointWinPct:0.64,returnPointWinPct:0.37,
    firstServeIn:0.62,firstServeWin:0.72,secondServeWin:0.53,
    returnFirstWin:0.31,returnSecondWin:0.48,aceRate:0.06,
    doubleFaultRate:0.03,bpSaveRate:0.6,bpFacedPerServiceGame:0.6,
    servicePointsPerGame:6,bpCreatePerReturnGame:0.45,
    bpConvertRate:0.42,aceAllowedRate:0.06,dfReceivedRate:0.04
  })
});
test('tennis prematch profiles accept valid provenance and complete features',()=>{
  assert.equal(validateTennisPrematchProfiles([profile('Alpha'),profile('Beta')],fixture,now),null);
});
test('tennis prematch profiles reject invalid and started fixtures',()=>{
  assert.equal(validateTennisPrematchProfiles([profile('Alpha'),profile('Beta')],{event_start_time:'bad'},now),'FIXTURE_TIME_INVALID_OR_STARTED');
  assert.equal(validateTennisPrematchProfiles([profile('Alpha'),profile('Beta')],{event_start_time:'2026-10-21T18:00:00Z'},now),'FIXTURE_TIME_INVALID_OR_STARTED');
});
test('tennis prematch profiles reject malformed history date and post-start retrieval',()=>{
  const a=profile('Alpha');a.last_match_date='not-a-date';
  assert.equal(validateTennisPrematchProfiles([a,profile('Beta')],fixture,now),'PROFILE_TIME_INVALID');
  const b=profile('Alpha');b.updated_at='2026-10-24T00:00:00Z';
  assert.notEqual(validateTennisPrematchProfiles([b,profile('Beta')],fixture,new Date('2026-10-24T01:00:00Z')),null);
});
