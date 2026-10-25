import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMlbModelFeatures,evaluateMlbFeaturePredictions,persistMlbModelFeatures,validatePregameSnapshot} from '../functions/lib/mlbModelFeatures.js';
import {sha256Hex} from '../functions/lib/sha256Hex.js';
const capturedAt='2026-10-24T12:00:00.000Z';
const row=(date,pa=1)=>({pitcher:'1',batter:'2',game_date:date,game_type:'R',game_pk:'10',at_bat_number:String(pa),pitch_number:'1',pitch_type:'FF',stand:'L',p_throws:'R',description:'hit_into_play',events:'field_out',type:'X',launch_speed:0,estimated_woba_using_speedangle:0});
const packet=rows=>({playerId:'1',role:'pitcher',season:2026,observedAt:'2026-10-24T10:00:00.000Z',sourceHash:sha256Hex(JSON.stringify(rows)),rows});
const build=packets=>buildMlbModelFeatures({packets,playerId:'1',role:'pitcher',capturedAt});
test('dated windows exclude same-day rows, deduplicate, retain measured zeroes and hand splits',()=>{
 const r=row('2026-10-23');const f=build([packet([r,r,row('2026-10-24',2),row('2026-08-01',3)])]);
 assert.equal(f.windows[0].splits[0].pitches,1);assert.equal(f.windows[2].splits[0].pitches,2);
 assert.equal(f.windows[0].splits[1].pitches,1);assert.equal(f.windows[0].splits[2].pitches,0);
 assert.equal(f.windows[0].splits[0].metrics.xwobacon.value,0);assert.equal(f.canAuthorizeWager,false);
});
test('future acquisitions, changed archives and wrong identities reject',()=>{
 const p=packet([row('2026-10-23')]);assert.throws(()=>build([{...p,observedAt:'2026-10-25T00:00:00Z'}]));
 assert.throws(()=>build([{...p,sourceHash:'bad'}]));assert.throws(()=>build([{...p,playerId:'9'}]));
});
test('feature persistence uses immutable evidence key and conditional put',async()=>{
 let stored;await persistMlbModelFeatures({ARCHIVE:{put:async(...args)=>{stored=args;}}},{packets:[packet([row('2026-10-23')])],playerId:'1',role:'pitcher',capturedAt});
 assert.match(stored[0],/^models\/mlb\/features\/v1\/pitcher\/1\/2026-10-24\/[a-f0-9]{64}\.json$/);
 assert.equal(stored[2].onlyIf.get('If-None-Match'),'*');
});
const prediction={contractId:'a',market:'pitcher_k',season:2026,scope:'postseason',championVersion:'v1',challengerVersion:'v2',featureHash:'abc',featureCapturedAt:capturedAt,capturedAt,gameStart:'2026-10-24T20:00:00Z',settledAt:'2026-10-25T00:00:00Z',champion:.5,challenger:.8,outcome:1};
test('paired score math, cohorts and no promotion',()=>{const r=evaluateMlbFeaturePredictions([prediction]);assert.equal(r.cohorts[0].champion.brier,.25);assert.ok(Math.abs(r.cohorts[0].challenger.brier-.04)<1e-12);assert.equal(r.canPromote,false);});
test('evaluation rejects duplicates, future features, late predictions, invalid probabilities',()=>{
 assert.throws(()=>evaluateMlbFeaturePredictions([prediction,prediction]));
 for(const change of [{champion:0},{champion:null},{featureCapturedAt:'2026-10-24T13:00:00Z'},{capturedAt:'2026-10-24T21:00:00Z'},{scope:null}])assert.throws(()=>evaluateMlbFeaturePredictions([{...prediction,...change}]));
});

test('feature API requires operator auth and refuses incomplete source coverage',async()=>{
 const {onRequestPost}=await import('../functions/api/mlb-model-features.js');
 const request=(body,auth=false)=>new Request('https://fbis-myz.pages.dev/api/mlb-model-features',{method:'POST',headers:auth?{'x-harvest-secret':'test-secret'}:{},body:JSON.stringify(body)});
 assert.equal((await onRequestPost({env:{},request:request({playerId:'1',role:'pitcher'})})).status,403);
 const env={HARVEST_SECRET:'test-secret',ARCHIVE:{get:async()=>null}};
 assert.equal((await onRequestPost({env,request:request({playerId:'1',role:'pitcher'},true)})).status,422);
 assert.equal((await onRequestPost({env,request:request({playerId:'oops',role:'pitcher'},true)})).status,400);
});

test('MLB PIT validation accepts verified nested source clocks at or before the exact T15 checkpoint',()=>{
 const fixture={game_time:'2026-10-25T19:00:00Z'},cutoff='2026-10-25T18:45:00Z';
 const features={lineups:{expected:[{playerId:'5',observedAt:cutoff}]},starter:{sourceObservedAt:'2026-10-25T17:00:00Z'},statcast:{featureEvidence:[{capturedAt:'2026-10-25T18:00:00Z',sources:[{acquiredAt:'2026-10-25T18:30:00Z'}]}]},park:{palAsOf:'2026-10-25T18:42:00Z'}};
 assert.equal(validatePregameSnapshot(fixture,features,cutoff),true);
});
test('MLB PIT validation rejects post-checkpoint sources even before first pitch',()=>{
 const fixture={game_time:'2026-10-25T19:00:00Z'},cutoff='2026-10-25T18:45:00Z';
 const features={lineups:[{playerId:'5',observedAt:'2026-10-25T18:50:00Z'}]};
 assert.throws(()=>validatePregameSnapshot(fixture,features,cutoff),/MLB_PIT_SOURCE_AFTER_CHECKPOINT/);
 assert.throws(()=>validatePregameSnapshot(fixture,{starter:{observation_timestamp:'2026-10-25T19:01:00Z'}},cutoff),/MLB_PIT_SOURCE_AFTER_CHECKPOINT/);
 assert.throws(()=>validatePregameSnapshot(fixture,{statcast:{sources:[{acquisition_timestamp:'2026-10-25T18:46:00Z'}]}},cutoff),/MLB_PIT_SOURCE_AFTER_CHECKPOINT/);
});
test('MLB PIT validation fails closed on missing/invalid capture clocks, future checkpoints, and nested invalid receipts',()=>{
 const fixture={game_time:'2026-10-25T19:00:00Z'};
 for(const cutoff of [undefined,'not-a-time','2026-10-25T19:00:00Z','2026-10-25T20:00:00Z'])
  assert.throws(()=>validatePregameSnapshot(fixture,{},cutoff),/MLB_PIT_GAME_AND_CHECKPOINT_REQUIRED/);
 assert.throws(()=>validatePregameSnapshot({}, {},'2026-10-25T18:45:00Z'),/MLB_PIT_GAME_AND_CHECKPOINT_REQUIRED/);
 assert.throws(()=>validatePregameSnapshot(fixture,{source:{observedAt:'bad'}},'2026-10-25T18:45:00Z'),/MLB_PIT_SOURCE_AFTER_CHECKPOINT/);
 assert.throws(()=>validatePregameSnapshot(fixture,null,'2026-10-25T18:45:00Z'),/MLB_PIT_FEATURE_EVIDENCE_REQUIRED/);
});

test('PIT compares UTC instants across explicit offsets, milliseconds, and provider epoch units',()=>{
 const fixture={game_time:'2026-10-25T14:00:00-05:00'};
 const cutoff='2026-10-25T13:45:00-05:00';
 const observed='2026-10-25T14:40:00-04:00'; // 18:40Z
 const millis=Date.parse('2026-10-25T18:40:00.000Z');
 assert.equal(validatePregameSnapshot(fixture,{source:{observedAt:observed,acquisition_timestamp:millis/1000,collectedAt:millis}},cutoff),true);
 assert.throws(()=>validatePregameSnapshot(fixture,{source:{observedAt:'2026-10-25T13:46:00-05:00'}},cutoff),/MLB_PIT_SOURCE_AFTER_CHECKPOINT/);
 assert.throws(()=>validatePregameSnapshot(fixture,{source:{acquiredAt:Date.parse('2026-10-25T18:46:00Z')/1000}},cutoff),/MLB_PIT_SOURCE_AFTER_CHECKPOINT/);
});
test('PIT rejects ambiguous timezone-less or invalid calendar timestamps instead of guessing UTC',()=>{
 const fixture={game_time:'2026-10-25T19:00:00Z'},cutoff='2026-10-25T18:45:00Z';
 for(const bad of ['2026-10-25T18:40:00','2026-10-25 18:40:00','2026-02-30T10:00:00Z','2026-10-25T25:00:00Z','2026-10-25T13:40:00+14:30','not-a-time',2026]){
  assert.throws(()=>validatePregameSnapshot(fixture,{src:{sourceObservedAt:bad}},cutoff),/MLB_PIT_SOURCE_AFTER_CHECKPOINT/);
 }
 assert.throws(()=>validatePregameSnapshot({game_time:'2026-10-25T14:00:00'}, {}, cutoff),/MLB_PIT_GAME_AND_CHECKPOINT_REQUIRED/);
 assert.throws(()=>validatePregameSnapshot(fixture, {}, '2026-10-25T18:45:00'),/MLB_PIT_GAME_AND_CHECKPOINT_REQUIRED/);
});
test('date-only source coverage is conservatively bounded at next UTC midnight, never presumed available at midnight',()=>{
 const fixture={game_time:'2026-10-25T19:00:00Z'},cutoff='2026-10-25T18:45:00Z';
 assert.equal(validatePregameSnapshot(fixture,{historical:{sourceObservedAt:'2026-10-24'}},cutoff),true);
 assert.throws(()=>validatePregameSnapshot(fixture,{today:{sourceObservedAt:'2026-10-25'}},cutoff),/MLB_PIT_SOURCE_AFTER_CHECKPOINT/);
 assert.throws(()=>validatePregameSnapshot(fixture,{source:{sourceObservedAt:'2026-10-26'}},cutoff),/MLB_PIT_SOURCE_AFTER_CHECKPOINT/);
});
test('offset feature captures use UTC calendar day in window filtering and immutable object key',async()=>{
 const localCapture='2026-10-24T23:30:00-05:00'; // October 25 UTC
 const p={...packet([row('2026-10-23'),row('2026-10-24',2)]),observedAt:'2026-10-24T18:00:00-05:00'};
 const evidence=buildMlbModelFeatures({packets:[p],playerId:'1',role:'pitcher',capturedAt:localCapture});
 assert.equal(evidence.throughExclusive,'2026-10-25');
 assert.equal(evidence.windows[0].splits[0].pitches,1);
 let stored;
 await persistMlbModelFeatures({ARCHIVE:{put:async (...args)=>{stored=args;}}},{packets:[p],playerId:'1',role:'pitcher',capturedAt:localCapture});
 assert.match(stored[0],/\/2026-10-25\/[a-f0-9]{64}\.json$/);
 assert.throws(()=>buildMlbModelFeatures({packets:[{...p,observedAt:'2026-10-24T23:45:00-05:00'}],playerId:'1',role:'pitcher',capturedAt:localCapture}),/FEATURE_SOURCE_NOT_AVAILABLE_OR_CORRUPT/);
});
