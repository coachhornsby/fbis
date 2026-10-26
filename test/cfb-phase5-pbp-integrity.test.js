import test from 'node:test';
import assert from 'node:assert/strict';
import {auditGame} from '../scripts/cfb-phase5-pbp-integrity.mjs';
const plays=[{id:'1',homeScore:7,awayScore:0},{id:'2',homeScore:14,awayScore:7}];
const drives=[{id:'d',plays:[{id:'1'},{id:'2'}]}];
const official={ncaa_home:14,ncaa_away:7,independent_ncaa_verified:true};
test('full matching game scores and drive play identities are structurally consistent',()=>{
 const a=auditGame({plays,drives,official,gameId:'1'});
 assert.equal(a.structurally_consistent,true);
 assert.equal(a.cross_provider_pbp_complete,false);
});
test('last PBP score mismatch must be surfaced despite NCAA verified final',()=>{
 const r=auditGame({plays,drives,official:{...official,ncaa_home:21},gameId:'2'});
 assert.ok(r.issues.includes('LAST_PLAY_SCORE_DISAGREES_NCAA_FINAL'));
 assert.equal(r.structurally_consistent,false);
});
test('duplicates and missing drive plays never pass',()=>{
 const r=auditGame({plays:[plays[0],plays[0]],drives:[{plays:[{id:'3'}]}],official,gameId:'3'});
 assert.ok(r.issues.includes('DUPLICATE_PLAY_IDS'));
 assert.ok(r.issues.includes('DRIVE_REFERENCES_MISSING_PLAY'));
});
