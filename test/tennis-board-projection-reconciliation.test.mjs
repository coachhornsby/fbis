import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileTennisCards} from '../scripts/lib/reconcile-tennis-cards.mjs';
const game=(changes={})=>({id:'tennis:kalshi:wta:1',tour:'wta',away:{name:'Jessica Pegula'},home:{name:'Jelena Ostapenko'},start:'2026-10-24T18:00:00Z',...changes});
const fixture=(changes={})=>({eventId:'official:abc',tour:'wta',player1:'Jelena Ostapenko',player2:'Jessica Pegula',start:'2026-10-24T18:05:00Z',available:true,...changes});
test('unambiguous official game may be recognized, without authority',()=>{
 const r=reconcileTennisCards([game()],[fixture()]);
 assert.equal(r.rows[0].status,'OFFICIAL_PROJECTION_AVAILABLE');
 assert.equal(r.rows[0].officialEventId,'official:abc');
 assert.equal(r.canAuthorizeWager,false);
});
test('missing official fixtures are not silently counted as projected',()=>{
 const r=reconcileTennisCards([game()],[]);
 assert.equal(r.byStatus.NO_MATCHING_OFFICIAL_FIXTURE,1);
});
test('ambiguous official matches must not select one',()=>{
 const r=reconcileTennisCards([game()],[fixture(),fixture({eventId:'official:def'})]);
 assert.equal(r.rows[0].status,'AMBIGUOUS_OFFICIAL_MATCH');
 assert.equal(r.rows[0].officialEventId,null);
});
test('cross-tour same-name pair cannot be considered matched',()=>{
 const r=reconcileTennisCards([game()],[fixture({tour:'atp'})]);
 assert.equal(r.rows[0].status,'NO_MATCHING_OFFICIAL_FIXTURE');
});
test('distant start times and absent board time prevent identity promotion',()=>{
 assert.equal(reconcileTennisCards([game({start:'2026-10-25T20:00:00Z'})],[fixture()]).rows[0].status,'NO_MATCHING_OFFICIAL_FIXTURE');
 assert.equal(reconcileTennisCards([game({start:null})],[fixture()]).rows[0].status,'BOARD_IDENTITY_OR_TIME_INCOMPLETE');
});
test('blocked official model remains blocked',()=>{
 const r=reconcileTennisCards([game()],[fixture({available:false,blockedReason:'SURFACE_PROFILE_MISSING'})]);
 assert.equal(r.rows[0].status,'OFFICIAL_PROJECTION_BLOCKED');
 assert.equal(r.rows[0].blockedReason,'SURFACE_PROFILE_MISSING');
});
