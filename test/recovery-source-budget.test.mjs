import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
test('licensed key remains scoped to same-day refresh, never tests or next-day capture',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/fbis-four-sport-recovery-once.yml',import.meta.url),'utf8');
 const beforeSteps=yaml.split('    steps:')[0];
 assert.equal(beforeSteps.includes('KENPOM_API_KEY:'),false);
 const sameDay=yaml.split("      - name: Refresh today's free-input research projections once")[1].split('      - name: Prepare next-day')[0];
 assert.match(sameDay,/KENPOM_API_KEY: \$\{\{ secrets\.KENPOM_API_KEY \|\| secrets\.KENPOM \}\}/);
 const nextDay=yaml.split('      - name: Prepare next-day')[1].split('      - name: Retain bounded')[0];
 assert.match(nextDay,/KENPOM_API_KEY: ""/);
 assert.equal(nextDay.includes('secrets.KENPOM'),false);
 assert.match(yaml,/cron: "20 12 \* \* \*"/);
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
