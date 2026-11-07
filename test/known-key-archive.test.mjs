import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {archiveKnownKeys,JOB} from '../services/archive/knownKeyArchive.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const data=new TextEncoder().encode('[{"value":1},{"value":2}]\n');
 const plan={contract:'fbis-known-key-plan-v1',batchId:'fixture',bucket:'fbis-archive',objects:[{key:'research/offline/a.json',bytes:data.length,records:2,sha256:sha(data),format:'json-array',sport:'CFB',provider:'fixture',season:'2004',schemaVersion:'fixture-v1',capturedAt:'2026-10-15T00:00:00Z'}]};
 const calls=[];const files=new Map();
 const grant={allowed:true,id:'test',job:JOB,expiresAtMs:Date.now()+110000,maxUnits:{r2Reads:2,r2Bytes:data.length,r2Lists:0,r2Writes:0,d1Queries:0,reads:0,writes:0}};
 const env={CLOUDFLARE_ACCOUNT_ID:'fixture-account',FBIS_ACCOUNT_BUDGET:{getByName(){return{async reserve(){calls.push('admission');return grant;}}}}};
 const bucket={async head(key){calls.push('head:'+key);return{size:data.length,etag:'etag'};},async get(key,options){calls.push('get:'+key);assert.deepEqual(options,{onlyIf:{etagMatches:'etag'}});return{size:data.length,etag:'etag',body:new Response(data).body};},list(){assert.fail('LIST is forbidden');},put(){assert.fail('R2 writes forbidden');},delete(){assert.fail('R2 deletes forbidden');}};
 const sink={async saveImmutable(name,raw){calls.push('save');if(files.has(name)){assert.deepEqual(files.get(name),raw);return{id:name,status:'existing_verified'};}files.set(name,raw.slice());return{id:name,status:'created_verified'};},async read(id,cap){calls.push('read');assert.ok(files.get(id).length<=cap);return files.get(id).slice();}};
 return{data,plan,calls,files,grant,env,bucket,sink,reservationId:'test'};
}
test('known-key HEAD/GET only; repeated copy produces stable content and independent restore',async()=>{
 const f=fixture();const first=await archiveKnownKeys(f);assert.equal(first.independentRestoreVerified,true);assert.deepEqual(first.budget.used,{r2Reads:2,r2Bytes:f.data.length});assert.deepEqual(f.calls.slice(0,3),['admission','head:research/offline/a.json','get:research/offline/a.json']);
 assert.equal(f.files.size,2);const second=await archiveKnownKeys(f);assert.equal(first.manifestId,second.manifestId);assert.deepEqual(second.operations,['existing_verified']);assert.equal(f.files.size,2);assert.equal(first.manifest.sourceDeletionAuthorized,false);
});
test('all HEAD metadata preflights finish before any GET or archive write',async()=>{
 const f=fixture();f.plan.objects.push({...f.plan.objects[0],key:'research/offline/b.json'});f.grant.maxUnits.r2Reads=4;f.grant.maxUnits.r2Bytes*=2;
 f.bucket.head=async key=>{f.calls.push('head');return key.endsWith('b.json')?null:{size:f.data.length,etag:'etag'};};await assert.rejects(()=>archiveKnownKeys(f),/HEAD_MISMATCH/);assert.deepEqual(f.calls,['admission','head','head']);
});
test('missing or denied budget, wrong grant identity and excessive mutation units fail before R2',async()=>{
 for(const kind of ['missing','denied','identity','mutation','reads','bytes','expired']){
  const f=fixture();if(kind==='missing')f.env={};if(kind==='denied')f.grant.allowed=false;if(kind==='identity')f.grant.job='other';if(kind==='mutation')f.grant.maxUnits.r2Lists=1;if(kind==='reads')f.grant.maxUnits.r2Reads=1;if(kind==='bytes')f.grant.maxUnits.r2Bytes=1;if(kind==='expired')f.grant.expiresAtMs=1;
  await assert.rejects(()=>archiveKnownKeys(f));assert.ok(f.calls.every(x=>x==='admission'));assert.equal(f.files.size,0);
 }
});
test('oversized, duplicate and malformed plans fail before even budget reservation',async()=>{
 for(const change of [f=>f.plan.objects[0].bytes=262145,f=>f.plan.objects.push({...f.plan.objects[0]}),f=>f.plan.objects[0].sha256='unknown',f=>f.plan.objects[0].key='research/../secret',f=>f.plan.objects[0].capturedAt='yesterday']){
  const f=fixture();change(f);await assert.rejects(()=>archiveKnownKeys(f));assert.equal(f.calls.length,0);
 }
});
test('source drift, absent body, unknown size, corrupt hash, oversized and short streams never write',async()=>{
 for(const kind of ['etag','no-body','unknown-size','hash','oversized','short']){
  const f=fixture();f.bucket.get=async()=>({size:kind==='unknown-size'?undefined:f.data.length,etag:kind==='etag'?'changed':'etag',body:kind==='no-body'?null:new Response(kind==='oversized'?new Uint8Array(f.data.length+1):kind==='short'?new Uint8Array(1):kind==='hash'?new Uint8Array(f.data.length):f.data).body});
  await assert.rejects(()=>archiveKnownKeys(f));assert.equal(f.files.size,0);
 }
});
test('count mismatch and invalid JSON fail before archive write',async()=>{
 const f=fixture();f.plan.objects[0].records=3;await assert.rejects(()=>archiveKnownKeys(f),/RECORD_COUNT/);assert.equal(f.files.size,0);
});
test('independent readback detects corrupt manifest or envelope',async()=>{
 for(const target of ['manifest-','object-']){
  const f=fixture();const read=f.sink.read;f.sink.read=async(id,cap)=>id.startsWith(target)?new TextEncoder().encode('{}'):read(id,cap);
  await assert.rejects(()=>archiveKnownKeys(f),/READBACK/);
 }
});
test('plan cannot change while admission is pending',async()=>{
 const f=fixture();f.env.FBIS_ACCOUNT_BUDGET.getByName=()=>({reserve:async()=>{f.plan.objects[0].key='research/other';return f.grant;}});
 const result=await archiveKnownKeys(f);assert.equal(result.manifest.files[0].key,'research/offline/a.json');
});
test('capability remains unregistered in production job certification',async()=>{
 const {executionPolicyError}=await import('../services/account-budget/executionJobs.mjs');
 assert.equal(executionPolicyError({jobs:{[JOB]:{maxUnits:fixture().grant.maxUnits}}},JOB),'JOB_EXECUTION_NOT_CERTIFIED');
});

test('NDJSON restore preserves original record bytes and counts',async()=>{
 const f=fixture();const data=new TextEncoder().encode('{"value":1}\n{"value":2}\n');
 Object.assign(f.plan.objects[0],{format:'ndjson',bytes:data.length,sha256:sha(data)});f.grant.maxUnits.r2Bytes=data.length;
 f.bucket.head=async()=>({size:data.length,etag:'etag'});f.bucket.get=async()=>({size:data.length,etag:'etag',body:new Response(data).body});
 const result=await archiveKnownKeys(f);assert.equal(result.manifest.totalRecords,2);assert.equal(result.independentRestoreVerified,true);
});

test('semantic plan property order cannot change archive content addresses',async()=>{
 const f=fixture();const first=await archiveKnownKeys(f);
 f.plan.objects[0]=Object.fromEntries(Object.entries(f.plan.objects[0]).reverse());
 const second=await archiveKnownKeys(f);assert.equal(first.manifestId,second.manifestId);assert.equal(f.files.size,2);assert.deepEqual(second.operations,['existing_verified']);
});
test('provenance JSON document copies no referenced objects and counts zero restored records',async()=>{
 const f=fixture();const data=new TextEncoder().encode(JSON.stringify({count:13644,segments:[{key:'research/never-fetch-this'}]}));
 Object.assign(f.plan.objects[0],{format:'json-document',records:0,bytes:data.length,sha256:sha(data)});f.grant.maxUnits.r2Bytes=data.length;
 f.bucket.head=async key=>{assert.equal(key,f.plan.objects[0].key);return{size:data.length,etag:'etag'};};
 let gets=0;f.bucket.get=async key=>{assert.equal(key,f.plan.objects[0].key);gets++;return{size:data.length,etag:'etag',body:new Response(data).body};};
 const result=await archiveKnownKeys(f);assert.equal(gets,1);assert.equal(result.manifest.totalRecords,0);assert.equal(result.referencedRecordsVerified,false);assert.equal(result.restoreScope,'archived-object-bytes-and-direct-records-only');
});
test('document mode refuses record claims and non-object JSON',async()=>{
 const f=fixture();f.plan.objects[0].format='json-document';await assert.rejects(()=>archiveKnownKeys(f),/EXPECTATION_INVALID/);assert.equal(f.calls.length,0);
 f.plan.objects[0].records=0;await assert.rejects(()=>archiveKnownKeys(f),/DOCUMENT_FORMAT/);assert.equal(f.files.size,0);
});
