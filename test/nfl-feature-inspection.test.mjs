import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectNflFeatureSnapshot,NFL_FEATURE_KEY,NFL_INSPECTION_ID} from '../services/nfl/inspectFeatureSnapshot.mjs';
import {NFL_SNAPSHOT_INSPECTION_JOB as JOB,CERTIFIED_EXECUTION_JOBS,executionPolicyError} from '../services/account-budget/executionJobs.mjs';
import {reserveJob} from '../services/account-budget/admission.mjs';
const units=CERTIFIED_EXECUTION_JOBS[JOB].units;
function setup({grant={},body='{}',size,denied=false}={}){
 const calls=[];
 const env={CLOUDFLARE_ACCOUNT_ID:'account',FBIS_ACCOUNT_BUDGET:{getByName(account){assert.equal(account,'account');return {async reserve(request){calls.push(['reserve',request]);return {allowed:!denied,reason:'PAUSED',id:NFL_INSPECTION_ID,job:JOB,maxUnits:{...units},expiresAtMs:Date.now()+60000,...grant};}};}},R2_ARCHIVE:{async get(key){calls.push(['get',key]);return {size:size??new TextEncoder().encode(body).length,body:new Response(body).body};}}};
 return {env,calls};
}
test('authenticated budget reservation precedes exactly one fixed-key read; binds exact bytes',async()=>{
 const {env,calls}=setup({body:'{"season":2026}'});const r=await inspectNflFeatureSnapshot(env);
 assert.deepEqual(calls.map(x=>x[0]),['reserve','get']);assert.equal(calls[1][1],NFL_FEATURE_KEY);
 assert.equal(r.snapshotSha256,createHash('sha256').update(r.snapshotText).digest('hex'));
 assert.equal(r.budget.used.r2Reads,1);assert.equal(r.productionAuthority,false);assert.equal(r.sourceFreshnessVerified,false);
});
test('missing authentication, denied budget, identity and units mismatch make zero reads',async()=>{
 await assert.rejects(()=>inspectNflFeatureSnapshot({R2_ARCHIVE:{get(){throw Error('must not read');}}}),/BINDING_REQUIRED/);
 for(const opts of [{denied:true},{grant:{id:'other'}},{grant:{job:'college'}},{grant:{maxUnits:{...units,r2Reads:2}}},{grant:{expiresAtMs:0}}]){
  const {env,calls}=setup(opts);await assert.rejects(()=>inspectNflFeatureSnapshot(env));assert.equal(calls.filter(c=>c[0]==='get').length,0);
 }
});
test('oversized metadata, short body, longer-than-declared body fail without retry',async()=>{
 for(const size of [8388609,1,3]){const {env,calls}=setup({size});await assert.rejects(()=>inspectNflFeatureSnapshot(env));assert.equal(calls.filter(c=>c[0]==='get').length,1);}
});
test('one read failure is not retried',async()=>{const {env,calls}=setup();env.R2_ARCHIVE.get=async()=>{calls.push(['get']);throw Error('uncertain');};await assert.rejects(()=>inspectNflFeatureSnapshot(env),/uncertain/);assert.equal(calls.filter(c=>c[0]==='get').length,1);});
test('code certification alone does not activate policy, which requires exact caps and coordinator overhead',()=>{
 assert.equal(executionPolicyError({jobs:{}},JOB),'MISSING_UNIT_BOUNDS');
 const p={jobs:{[JOB]:{maxUnits:{...units},coordinatorOverheadMicroUsd:1,preAdmissionAttemptCeiling:1,runtimeCpuLimitMs:100}},unitCeilings:{inspectionAttempts:1}};
 assert.equal(executionPolicyError(p,JOB),null);
 p.jobs[JOB].maxUnits.r2Reads=2;assert.equal(executionPolicyError(p,JOB),'INSPECTION_EXACT_UNITS_REQUIRED');
});
test('NFL inspection reserves coordinator cost and blocks transaction retry',async()=>{
 const now=Date.now(),p={enabled:true,startMs:now-1,endMs:now+60000,measuredAtMs:now,expiresAtMs:now+60000,committedMicroUsd:0,unitCeilings:{...units},jobs:{[JOB]:{maxUnits:{...units},worstCaseMicroUsd:2,coordinatorOverheadMicroUsd:1}}};
 const tx={get:async()=>null,put:async()=>{}};
 const grant=await reserveJob({transaction:fn=>fn(tx)},p,{id:NFL_INSPECTION_ID,job:JOB},now);assert.equal(grant.reservedMicroUsd,3);
 await assert.rejects(()=>reserveJob({transaction:async fn=>{await fn(tx);return fn(tx);}},p,{id:NFL_INSPECTION_ID,job:JOB},now),/RETRY_BLOCKED/);
});
test('exact 8 MiB succeeds and invalid UTF-8 fails',async()=>{
 const exact=setup({body:' '.repeat(8388608)});assert.equal((await inspectNflFeatureSnapshot(exact.env)).bytes,8388608);
 const bad=setup();bad.env.R2_ARCHIVE.get=async()=>({size:1,body:new Response(new Uint8Array([255])).body});await assert.rejects(()=>inspectNflFeatureSnapshot(bad.env),/encoded data/);
});
test('multi-chunk stream overflow cancels its source',async()=>{
 const {env}=setup();let reads=0,cancelled=false;
 env.R2_ARCHIVE.get=async()=>({size:2,body:new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array([1,2]));},cancel(){cancelled=true;}},{highWaterMark:0})});
 await assert.rejects(()=>inspectNflFeatureSnapshot(env),/SIZE_MISMATCH/);assert.ok(reads>=2);assert.equal(cancelled,true);
});

test('inspection distinguishes confirmed absence and reports exact predecessor without extra reads',async()=>{
 const absent=setup();absent.env.R2_ARCHIVE.get=async()=>null;const a=await inspectNflFeatureSnapshot(absent.env);assert.equal(a.found,false);assert.equal(a.etag,null);assert.equal(a.budget.used.r2Reads,1);
 const present=setup();present.env.R2_ARCHIVE.get=async()=>({size:2,body:new Response('{}').body,etag:'existing-etag',customMetadata:{builtAt:'2026-11-08T00:00:00Z'}});const p=await inspectNflFeatureSnapshot(present.env);assert.equal(p.found,true);assert.equal(p.etag,'existing-etag');assert.equal(p.predecessorBuiltAt,'2026-11-08T00:00:00Z');assert.equal(p.budget.used.r2Reads,1);
});
