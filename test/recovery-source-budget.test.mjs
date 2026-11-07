import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoverySourceBudget,recoveryCoverage} from '../scripts/lib/recoveryEvidence.mjs';
test('schedule and history share a hard ESPN cap; denied reservations do not increment',()=>{
 const b=createRecoverySourceBudget();
 for(let i=0;i<8;i++)b.reserve('ESPN');
 for(let i=0;i<126;i++)b.reserve('ESPN');
 assert.equal(b.counts.ESPN,134);
 assert.throws(()=>b.reserve('ESPN'),/BUDGET/);assert.equal(b.counts.ESPN,134);
 b.reserve('KenPom');assert.throws(()=>b.reserve('KenPom'),/BUDGET/);
 assert.throws(()=>b.reserve('Torvik'),/NOT_ALLOWED/);
});
test('coverage reports missing forecasts and expiry before kickoff without extending freshness',()=>{
 const target=[{id:'1'},{id:'2'}],events=[{eventId:'1',start:'2026-11-07T20:00:00Z'}];
 const c=recoveryCoverage(target,events,'2026-11-07T13:00:00Z');
 assert.equal(c.state,'PARTIAL');assert.deepEqual(c.missingEventIds,['2']);
 assert.deepEqual(c.expiresBeforeStartEventIds,['1']);assert.equal(c.canAuthorizeWager,false);
 assert.equal(recoveryCoverage(target,[],null).state,'UNAVAILABLE');
 assert.equal(recoveryCoverage([],[],null).state,'NO_SCHEDULED_GAMES');
 assert.equal(recoveryCoverage([{id:'1'}],events,'2026-11-07T23:00:00Z').state,'COMPLETE');
});
