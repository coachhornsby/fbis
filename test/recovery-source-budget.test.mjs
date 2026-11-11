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

const completeReceipt=()=>({generatedAt:'2026-11-10T19:45:10.191Z',coverageState:'COMPLETE',errors:[],
 written:[{sport:'cbb',events:1,stored:true}],forecastCoverage:Object.fromEntries(['cbb','nfl','nba','cfb'].map(s=>[s,
  {state:s==='cbb'?'COMPLETE':'NO_SCHEDULED_GAMES',scheduled:s==='cbb'?1:0,projected:s==='cbb'?1:0,
   missingEventIds:[],expiresBeforeStartEventIds:[],expiresAt:s==='cbb'?'2026-11-11T01:45:04.581Z':null}]))});
const diagnosticClock={nowMs:Date.parse('2026-11-10T19:46Z')};
test('Nov10 Torvik first-source 403 is visible despite successful primary publication',()=>{
 const r={...completeReceipt(),providerCalls:{ESPN:107,KenPom:1,Torvik:1},
  torvik:{state:'UNAVAILABLE',source:'BULK_CAPTURE',season:2027,receipts:[],error:'TORVIK_HTTP_403',providerUpdatedAt:null}};
 const before=JSON.stringify(r),d=recoveryReceiptDiagnostics(r,diagnosticClock);
 assert.equal(d.state,'ATTENTION_REQUIRED');assert.deepEqual(d.reasons,['TORVIK_CAPTURE_FAILED','TORVIK_HTTP_403']);
 assert.deepEqual(d.sources.torvik,{state:'UNAVAILABLE',source:'BULK_CAPTURE',errorCode:'TORVIK_HTTP_403',
  acceptedReceiptCount:0,flags:['TORVIK_CAPTURE_FAILED','TORVIK_HTTP_403']});
 assert.deepEqual(d.sports.cbb.flags,[]);assert.equal(d.action,'ALERT_ONLY');assert.equal(d.canDispatch,false);
 assert.equal(d.canAuthorizeWager,false);assert.equal(JSON.stringify(r),before);
});
test('missing next-day input reports the reuse cause without inventing an upstream HTTP failure',()=>{
 for(const error of ["ENOENT: no such file or directory, stat '/home/runner/work/_temp/fbis-torvik-ratings.json'",'TORVIK_REUSED_INPUT_MISSING']){
  const r={...completeReceipt(),torvik:{state:'UNAVAILABLE',source:'SAME_JOB_REUSE',receipts:[],error}};
  const d=recoveryReceiptDiagnostics(r,diagnosticClock);
  assert.deepEqual(d.reasons,['TORVIK_REUSE_FAILED','TORVIK_REUSED_INPUT_MISSING']);
  assert.equal(d.sources.torvik.errorCode,'TORVIK_REUSED_INPUT_MISSING');assert.equal(d.sources.torvik.acceptedReceiptCount,0);
  assert.doesNotMatch(JSON.stringify(d),/HTTP_403|\/home\/runner/);
 }
});
test('other capture and reuse failures remain distinct and do not suggest retrying',()=>{
 for(const [source,error] of [['BULK_CAPTURE','TORVIK_FACTOR_SCHEMA_UNVERIFIED'],['SAME_JOB_REUSE','INVALID_TORVIK_REUSED_INPUT']]){
  const r={...completeReceipt(),torvik:{state:'UNAVAILABLE',source,receipts:[{httpStatus:200}],error}};
  const d=recoveryReceiptDiagnostics(r,diagnosticClock);
  assert.equal(d.sources.torvik.acceptedReceiptCount,1);assert.equal(d.sources.torvik.errorCode,error);
  assert.deepEqual(d.reasons,[source==='BULK_CAPTURE'?'TORVIK_CAPTURE_FAILED':'TORVIK_REUSE_FAILED',error]);
  assert.equal(d.canDispatch,false);assert.equal(d.action,'ALERT_ONLY');
 }
});
test('absent or deliberately unadmitted Torvik does not manufacture a source failure',()=>{
 for(const torvik of [undefined,{state:'NOT_ADMITTED',receipts:[]}]){
  const d=recoveryReceiptDiagnostics({...completeReceipt(),torvik},diagnosticClock);
  assert.equal(d.state,'CURRENT');assert.deepEqual(d.reasons,[]);
 }
});
test('successful Torvik does not alter forecast freshness or add alert reasons',()=>{
 const r={...completeReceipt(),torvik:{state:'PRIVATE_RESEARCH_INPUT',source:'SAME_JOB_REUSE',error:null,
  receipts:[{httpStatus:200},{httpStatus:200}]}};
 const d=recoveryReceiptDiagnostics(r,diagnosticClock);
 assert.equal(d.state,'CURRENT');assert.deepEqual(d.sources.torvik.flags,[]);assert.equal(d.sources.torvik.acceptedReceiptCount,2);
 assert.equal(d.sports.cbb.expiresAt,r.forecastCoverage.cbb.expiresAt);
 assert.ok(recoveryReceiptDiagnostics(r,{nowMs:Date.parse(r.forecastCoverage.cbb.expiresAt)}).sports.cbb.flags.includes('EXPIRED'));
});
test('runner warns on Torvik source diagnostics without changing its publication exit condition',()=>{
 const runner=readFileSync(new URL('../scripts/recover-four-sport-once.mjs',import.meta.url),'utf8');
 assert.match(runner,/if\(results\.diagnostics\.sources\.torvik\?\.flags\.length\)console\.warn\('::warning::Torvik comparison unavailable:/);
 assert.match(runner,/if\(results\.errors\.length\|\|!results\.written\.some\(x=>x\.stored\)\)process\.exitCode=1/);
});
