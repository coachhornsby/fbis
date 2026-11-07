import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runBoundedArchive} from '../services/archive/unifiedArchiveCaller.mjs';
import {archiveKnownKeys,JOB} from '../services/archive/knownKeyArchive.mjs';
import {createDriveArchiveSink,DRIVE_ROOT,DRIVE_LIMITS} from '../services/archive/driveArchiveSink.mjs';
import {createExecutionLease} from '../services/account-budget/execution.mjs';
const enc=new TextEncoder(),dec=new TextDecoder();
const sha=b=>createHash('sha256').update(b).digest('hex');
const folder=(id,name,parent)=>({id,name,parents:parent?[parent]:[],mimeType:'application/vnd.google-apps.folder',trashed:false});
function fixture(){
 const raw=enc.encode('{"segments":["never-follow"]}');
 const plan={contract:'fbis-known-key-plan-v1',batchId:'shared-fixture',bucket:'fbis-archive',objects:[{key:'research/fixture/manifest.json',bytes:raw.length,records:0,sha256:sha(raw),format:'json-document',sport:'CFB',provider:'fixture',season:'2004',schemaVersion:'fixture-v1',capturedAt:'2026-10-15T00:00:00Z'}]};
 const items=new Map([[DRIVE_ROOT,folder(DRIVE_ROOT,'FBIS_Data')],['cat',folder('cat','04_Model_Evidence',DRIVE_ROOT)],['dest',folder('dest','Known_Key_Archive','cat')]]),files=new Map(),ids=new Set();
 const f={raw,plan,items,files,calls:[],wireBytes:0,reserves:0,grant:null,hook:null,reservationId:'one',drive:{categoryId:'cat',archiveFolderId:'dest',authorization:'Bearer offline-fixture'}};
 f.grant={allowed:true,id:'one',job:JOB,expiresAtMs:Date.now()+110000,maxUnits:{requests:24,responseBytes:2097152,r2Reads:2,r2Bytes:raw.length,r2Lists:0,r2Writes:0,d1Queries:0,reads:0,writes:0}};
 f.env={CLOUDFLARE_ACCOUNT_ID:'offline-account',FBIS_ARCHIVE:{head:async()=>{f.calls.push('head');return{size:raw.length,etag:'etag'};},get:async()=>{f.calls.push('get');return{size:raw.length,etag:'etag',body:new Response(raw).body};}},FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async({id})=>{f.reserves++;if(ids.has(id))return{allowed:false,reason:'DUPLICATE_JOB'};ids.add(id);return f.grant;}})}};
 f.fetchImpl=async(input,init)=>{
  const url=new URL(input);f.calls.push(init.method);assert.equal(url.origin,'https://www.googleapis.com');assert.equal(init.redirect,'manual');assert.equal(init.headers.get('Authorization'),'Bearer offline-fixture');
  if(f.hook){const r=await f.hook(url,init);if(r)return r;}
  let body;
  if(init.method==='POST'){
   const boundary=init.headers.get('Content-Type').split('boundary=')[1],parts=dec.decode(init.body).split('--'+boundary),meta=JSON.parse(parts[1].split('\r\n\r\n')[1]);
   const data=enc.encode(parts[2].split('\r\n\r\n')[1].slice(0,-2));const id='file'+files.size;body={...meta,id,trashed:false};items.set(id,body);files.set(id,data);
  }else if(url.pathname==='/drive/v3/files'){
   const name=url.searchParams.get('q').match(/name = '([^']+)'/)[1];body={files:[...items.values()].filter(x=>x.name===name&&x.parents[0]==='dest')};
  }else{const id=url.pathname.split('/').at(-1);body=url.searchParams.get('alt')==='media'?files.get(id):items.get(id);}
  const data=body instanceof Uint8Array?body:enc.encode(JSON.stringify(body));f.wireBytes+=data.length;return new Response(data);
 };
 return f;
}
test('one admission and one lease account for R2 and every Drive response/request',async()=>{
 const f=fixture();const result=await runBoundedArchive(f);assert.equal(f.reserves,1);
 assert.deepEqual(f.calls.slice(0,2),['head','get']);assert.equal(result.budget.used.r2Reads,2);assert.equal(result.budget.used.r2Bytes,f.raw.length);
 assert.equal(result.budget.used.requests,f.calls.length-2);assert.equal(result.budget.used.requests,15);
 assert.equal(result.budget.used.responseBytes,f.wireBytes);assert.equal(result.driveBudget.requests,15);assert.equal(result.manifest.totalRecords,0);assert.equal(result.referencedRecordsVerified,false);
 assert.ok(!JSON.stringify(result).includes('offline-fixture'));
});
test('denied, expired, wrong identity, duplicate and missing Drive bounds cause no new IO',async()=>{
 for(const kind of ['denied','expired','identity','request-bounds','response-bounds']){
  const f=fixture();if(kind==='denied'){f.grant.allowed=false;f.grant.reason='PAUSED';}if(kind==='expired')f.grant.expiresAtMs=1;if(kind==='identity')f.grant.job='another';if(kind==='request-bounds')delete f.grant.maxUnits.requests;if(kind==='response-bounds')f.grant.maxUnits.responseBytes=1;
  await assert.rejects(()=>runBoundedArchive(f));assert.equal(f.calls.length,0);
 }
 const f=fixture();await runBoundedArchive(f);const count=f.calls.length;await assert.rejects(()=>runBoundedArchive(f),/DUPLICATE_JOB/);assert.equal(f.calls.length,count);
});
test('first-run size/object/format and auth/binding scope reject before admission',async()=>{
 for(const change of [f=>f.plan.objects[0].bytes=4097,f=>f.plan.objects.push({...f.plan.objects[0]}),f=>f.plan.objects[0].format='json-array',f=>f.drive.authorization='bad',f=>delete f.env.FBIS_ARCHIVE]){
  const f=fixture();change(f);await assert.rejects(()=>runBoundedArchive(f));assert.equal(f.reserves,0);assert.equal(f.calls.length,0);
 }
});
test('sink factory receives the R2 lease once and cannot be combined with another sink',async()=>{
 const f=fixture();let created=0,lease;const sinkFactory=l=>{created++;lease=l;l.stop('OFFLINE_STOP');};
 await assert.rejects(()=>archiveKnownKeys({env:f.env,bucket:f.env.FBIS_ARCHIVE,plan:f.plan,reservationId:'one',sinkFactory}),/OFFLINE_STOP/);
 assert.equal(created,1);assert.equal(lease.snapshot().closed,true);assert.equal(f.calls.length,0);
 const other=fixture();await assert.rejects(()=>archiveKnownKeys({env:other.env,plan:other.plan,sink:{},sinkFactory}),/FACTORY_INVALID/);assert.equal(other.reserves,0);
});
test('shared Drive request/response ceilings stop network and close the same lease',async()=>{
 for(const unit of ['requests','responseBytes']){
  const f=fixture();const grant={...f.grant,maxUnits:{requests:24,responseBytes:2097152,[unit]:unit==='requests'?1:1}};
  const lease=createExecutionLease(grant);const sink=createDriveArchiveSink({categoryId:'cat',archiveFolderId:'dest',executionLease:lease,authenticatedFetch:(url,init)=>f.fetchImpl(url,{...init,headers:new Headers({...init.headers,Authorization:'Bearer offline-fixture'})})});
  const data=enc.encode('{}');await assert.rejects(()=>sink.saveImmutable('object-'+sha(data)+'.json',data),/JOB_UNIT_LIMIT/);
  assert.equal(f.calls.length,1);assert.equal(lease.snapshot().closed,true);assert.throws(()=>lease.spend({r2Reads:1}),/STOPPED/);
 }
});
test('sink failures stop the shared lease and JSON errors do not expose remote body',async()=>{
 const f=fixture(),lease=createExecutionLease(f.grant);const sink=createDriveArchiveSink({categoryId:'cat',archiveFolderId:'dest',executionLease:lease,authenticatedFetch:async()=>new Response('sensitive-body-fixture')});
 const data=enc.encode('{}');await assert.rejects(()=>sink.saveImmutable('object-'+sha(data)+'.json',data),error=>error.message==='DRIVE_JSON_INVALID');assert.equal(lease.snapshot().closed,true);
});
test('admission delay cannot mutate plan or authorization/destination snapshots',async()=>{
 const f=fixture(),reserve=f.env.FBIS_ACCOUNT_BUDGET.getByName().reserve;
 f.env.FBIS_ACCOUNT_BUDGET.getByName=()=>({reserve:async args=>{f.plan.objects[0].key='research/changed';f.drive.authorization='Bearer changed';f.drive.archiveFolderId='outside';return reserve(args);}});
 const result=await runBoundedArchive(f);assert.equal(result.manifest.files[0].key,'research/fixture/manifest.json');
});
