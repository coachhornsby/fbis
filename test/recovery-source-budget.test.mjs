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

import {recoveryReceiptDiagnostics} from '../scripts/lib/recoveryEvidence.mjs';
const realistic=()=>({generatedAt:'2026-11-07T17:45:20.790Z',coverageState:'PARTIAL',errors:[],written:[{sport:'cbb',events:46,stored:true},{sport:'cfb',events:39,stored:true}],forecastCoverage:{cbb:{state:'PARTIAL',scheduled:58,projected:46,expiresAt:'2026-11-07T23:45:20.790Z',missingEventIds:Array(12).fill('missing'),expiresBeforeStartEventIds:Array(17).fill('late')},cfb:{state:'PARTIAL',scheduled:40,projected:39,expiresAt:'2026-11-08T11:45:20.790Z',missingEventIds:['401858290'],expiresBeforeStartEventIds:[]}}});
test('realistic successful Nov7 receipt still reports missing and late forecasts',()=>{
 const r=realistic(),before=JSON.stringify(r),d=recoveryReceiptDiagnostics(r,{nowMs:Date.parse('2026-11-07T21:35Z')});
 assert.equal(d.state,'ATTENTION_REQUIRED');assert.equal(d.sports.cbb.missingCount,12);assert.equal(d.sports.cbb.expiresBeforeKickoffCount,17);assert.deepEqual(d.sports.cbb.flags,['COVERAGE_PARTIAL','MISSING_FORECASTS','EXPIRES_BEFORE_KICKOFF']);assert.equal(d.canDispatch,false);assert.equal(JSON.stringify(r),before);
});
test('exact expiry becomes expired, never extends capture',()=>assert.ok(recoveryReceiptDiagnostics(realistic(),{nowMs:Date.parse('2026-11-07T23:45:20.790Z')}).sports.cbb.flags.includes('EXPIRED')));
test('missing, future, unpublished and malformed evidence fail closed',()=>{
 assert.equal(recoveryReceiptDiagnostics(null).state,'ATTENTION_REQUIRED');
 const r=realistic();r.generatedAt='2099-01-01';r.written=[];r.forecastCoverage.cbb.expiresAt='bad';
 const d=recoveryReceiptDiagnostics(r);assert.ok(d.reasons.includes('FUTURE_CAPTURE_TIME'));assert.ok(d.sports.cbb.flags.includes('PUBLICATION_UNVERIFIED'));assert.ok(d.sports.cbb.flags.includes('INVALID_EXPIRY'));
});
test('deadline checks distinguish timely early capture from missed refresh',()=>{
 const r=realistic(),opts={nowMs:Date.parse('2026-11-07T18:01Z'),minCaptureAt:'2026-11-07T17:30Z',deadlineAt:'2026-11-07T18:00Z'};
 assert.ok(!recoveryReceiptDiagnostics(r,opts).reasons.includes('REFRESH_DEADLINE_MISSED'));
 r.generatedAt='2026-11-07T13:28Z';assert.ok(recoveryReceiptDiagnostics(r,opts).reasons.includes('REFRESH_DEADLINE_MISSED'));
 assert.throws(()=>recoveryReceiptDiagnostics(r,{...opts,minCaptureAt:'bad'}),/INVALID_REFRESH_WINDOW/);
});

test('structurally incomplete evidence never reports CURRENT',()=>{
 for(const c of [null,{scheduled:null,projected:null},{state:'UNAVAILABLE',scheduled:0,projected:0,missingEventIds:['x']}]){
  const d=recoveryReceiptDiagnostics({generatedAt:'2026-11-07T17:45Z',coverageState:'COMPLETE',forecastCoverage:{cbb:c}},{nowMs:Date.parse('2026-11-07T18:00Z')});assert.equal(d.state,'ATTENTION_REQUIRED');
 }
});
test('valid complete four-sport empty slate is current',()=>{
 const forecastCoverage=Object.fromEntries(['cbb','cfb','nba','nfl'].map(s=>[s,{state:'NO_SCHEDULED_GAMES',scheduled:0,projected:0,missingEventIds:[],expiresBeforeStartEventIds:[],expiresAt:null}]));
 assert.equal(recoveryReceiptDiagnostics({generatedAt:'2026-11-07T17:45Z',coverageState:'COMPLETE',written:[],forecastCoverage},{nowMs:Date.parse('2026-11-07T18:00Z')}).state,'CURRENT');
});
