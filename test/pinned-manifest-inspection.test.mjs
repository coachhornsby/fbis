import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectPinnedManifest,PINNED_MANIFEST,INSPECTION_RESERVATION_ID} from '../services/archive/inspectPinnedManifest.mjs';
import {handlePinnedManifestInspection,INSPECTION_PATH} from '../workers/pinned-manifest-inspection-route.mjs';
import {PINNED_INSPECTION_JOB,CERTIFIED_EXECUTION_JOBS,executionPolicyError} from '../services/account-budget/executionJobs.mjs';
import {reserveJob,STOP_MICRO_USD} from '../services/account-budget/admission.mjs';
const units=CERTIFIED_EXECUTION_JOBS[PINNED_INSPECTION_JOB].units;
function fixture(){
 const calls=[];const grant={allowed:true,job:PINNED_INSPECTION_JOB,id:INSPECTION_RESERVATION_ID,expiresAtMs:Date.now()+110000,maxUnits:{...units}};
 const env={FBIS_PINNED_INSPECTION_ENABLED:'true',ORCH_CONTROL_TOKEN:'T'.repeat(48),CLOUDFLARE_ACCOUNT_ID:'offline',FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async request=>{calls.push('admission');assert.equal(request.job,PINNED_INSPECTION_JOB);assert.equal(request.id,INSPECTION_RESERVATION_ID);return grant;}})},R2_ARCHIVE:{head:async key=>{calls.push('head');assert.equal(key,PINNED_MANIFEST.key);return{size:2456,etag:'etag'};},get:async(key,options)=>{calls.push('get');assert.equal(key,PINNED_MANIFEST.key);assert.deepEqual(options,{onlyIf:{etagMatches:'etag'}});return{size:2456,etag:'etag',body:new Response('x'.repeat(2456)).body};},list(){assert.fail('LIST forbidden');},put(){assert.fail('write forbidden');},delete(){assert.fail('delete forbidden');}}};
 return{env,calls,grant};
}
function policy(){const now=Date.now();return{enabled:true,startMs:now-1000,endMs:now+3600000,measuredAtMs:now,expiresAtMs:now+900000,committedMicroUsd:0,unitCeilings:{...units},jobs:{[PINNED_INSPECTION_JOB]:{worstCaseMicroUsd:10,coordinatorOverheadMicroUsd:7,preAdmissionAttemptCeiling:1,runtimeCpuLimitMs:10,maxUnits:{...units}}}};}
function storage(){const data=new Map();return{data,transaction:async fn=>fn({get:async k=>data.get(k),put:async(k,v)=>data.set(k,structuredClone(v))})};}
test('exact pinned source has no runtime caller override and never accepts wrong content',async()=>{
 const f=fixture();await assert.rejects(()=>inspectPinnedManifest(f.env,{key:'another'}),/HASH_MISMATCH/);assert.deepEqual(f.calls,['admission','head','get']);
 assert.equal(PINNED_MANIFEST.bytes,2456);assert.ok(PINNED_MANIFEST.key.endsWith(PINNED_MANIFEST.sha256+'.json'));assert.equal(units.r2Bytes,4096);assert.equal(units.r2Reads,2);
});
test('disabled/unauthed/body/query/wrong-method route cannot reach admission or source',async()=>{
 const variants=[f=>delete f.env.FBIS_PINNED_INSPECTION_ENABLED,()=>null];
 for(const change of variants){const f=fixture();change(f);const response=await handlePinnedManifestInspection(new Request('https://offline'+INSPECTION_PATH,{method:'POST'}),f.env);assert.ok([404,401].includes(response.status));assert.equal(f.calls.length,0);}
 for(const request of [new Request('https://offline'+INSPECTION_PATH,{headers:{authorization:'Bearer '+'T'.repeat(48)}}),new Request('https://offline'+INSPECTION_PATH+'?key=other',{method:'POST',headers:{authorization:'Bearer '+'T'.repeat(48)}}),new Request('https://offline'+INSPECTION_PATH,{method:'POST',body:'{}',headers:{authorization:'Bearer '+'T'.repeat(48)}})]){const f=fixture();assert.equal((await handlePinnedManifestInspection(request,f.env)).status,400);assert.equal(f.calls.length,0);}
});
test('denied/expired/mismatched/incomplete grants stop before HEAD',async()=>{
 for(const kind of ['denied','expired','identity','bounds']){const f=fixture();if(kind==='denied'){f.grant.allowed=false;f.grant.reason='UNAPPROVED_JOB';}if(kind==='expired')f.grant.expiresAtMs=1;if(kind==='identity')f.grant.id='wrong';if(kind==='bounds')delete f.grant.maxUnits.coordinatorCalls;await assert.rejects(()=>inspectPinnedManifest(f.env));assert.deepEqual(f.calls,['admission']);}
});
test('HEAD drift, conditional GET drift, unknown/oversized stream fail without other APIs',async()=>{
 for(const kind of ['head','get','size','stream']){const f=fixture();if(kind==='head')f.env.R2_ARCHIVE.head=async()=>({size:4097,etag:'etag'});else f.env.R2_ARCHIVE.get=async()=>({size:kind==='size'?undefined:2456,etag:kind==='get'?'changed':'etag',body:new Response('x'.repeat(kind==='stream'?5000:2456)).body});await assert.rejects(()=>inspectPinnedManifest(f.env));assert.ok(f.calls.length<=2);}
});
test('code certification requires separate overhead and exact single-success unit policy',()=>{
 const p=policy();assert.equal(executionPolicyError(p,PINNED_INSPECTION_JOB),null);
 for(const change of [p=>delete p.jobs[PINNED_INSPECTION_JOB].coordinatorOverheadMicroUsd,p=>p.jobs[PINNED_INSPECTION_JOB].preAdmissionAttemptCeiling=2,p=>delete p.jobs[PINNED_INSPECTION_JOB].runtimeCpuLimitMs,p=>p.unitCeilings.inspectionAttempts=2,p=>p.jobs[PINNED_INSPECTION_JOB].maxUnits.r2Lists=1,p=>delete p.jobs[PINNED_INSPECTION_JOB].maxUnits.coordinatorStoragePuts]){const copy=structuredClone(p);change(copy);assert.ok(executionPolicyError(copy,PINNED_INSPECTION_JOB));}
});
test('account reservation adds coordinator overhead and single-success ceiling blocks another ID',async()=>{
 const p=policy(),s=storage();const result=await reserveJob(s,p,{job:PINNED_INSPECTION_JOB,id:'one'});assert.equal(result.allowed,true);assert.equal(result.reservedMicroUsd,17);assert.equal(result.projectedMicroUsd,17);
 assert.equal((await reserveJob(s,p,{job:PINNED_INSPECTION_JOB,id:'different'})).reason,'ACCOUNT_UNIT_STOP');
 const near=policy();near.committedMicroUsd=STOP_MICRO_USD-16;assert.equal((await reserveJob(storage(),near,{job:PINNED_INSPECTION_JOB,id:'near'})).reason,'ACCOUNT_BUDGET_STOP');
});
test('inspection admission transaction retries fail before extra storage operations',async()=>{
 let gets=0,puts=0;const txn={get:async()=>{gets++;return undefined;},put:async()=>{puts++;}};
 const s={transaction:async fn=>{await fn(txn);return fn(txn);}};
 await assert.rejects(()=>reserveJob(s,policy(),{job:PINNED_INSPECTION_JOB,id:'one'}),/RETRY_BLOCKED/);assert.equal(gets,2);assert.equal(puts,2);
});
test('route is wired before legacy broad admission but runtime flag stays absent and jobs unapproved',()=>{
 const source=readFileSync(new URL('../workers/sports-projection-orchestrator-worker.mjs',import.meta.url),'utf8').split('async function handleFetch')[1];assert.ok(source.indexOf('const inspection=await handlePinnedManifestInspection')<source.indexOf('  configureRuntime(env);'));
 const config=readFileSync(new URL('../wrangler.orchestrator.toml',import.meta.url),'utf8');assert.ok(config.includes('bucket_name = "fbis-archive"'));assert.ok(!config.includes('FBIS_PINNED_INSPECTION_ENABLED'));
 const baseline=readFileSync(new URL('../services/account-budget/wrangler.jsonc',import.meta.url),'utf8');assert.ok(!baseline.includes(PINNED_INSPECTION_JOB));
});
