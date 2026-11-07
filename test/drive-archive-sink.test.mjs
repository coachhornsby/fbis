import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDriveArchiveSink,DRIVE_ROOT,DRIVE_LIMITS} from '../services/archive/driveArchiveSink.mjs';
import {archiveKnownKeys,JOB} from '../services/archive/knownKeyArchive.mjs';
const enc=new TextEncoder(),dec=new TextDecoder();
const hash=data=>createHash('sha256').update(data).digest('hex');
const folder=(id,name,parent)=>({id,name,mimeType:'application/vnd.google-apps.folder',parents:parent?[parent]:[],trashed:false});
function drive(){
 const items=new Map([[DRIVE_ROOT,folder(DRIVE_ROOT,'FBIS_Data')],['category',folder('category','04_Model_Evidence',DRIVE_ROOT)],['archive',folder('archive','Known_Key_Archive','category')]]);
 const bodies=new Map(),calls=[];let counter=0;
 const fake={items,bodies,calls,hook:null};
 fake.fetch=async(input,init)=>{
  const url=new URL(input);calls.push({url,method:init.method});assert.equal(init.redirect,'manual');assert.ok(init.signal);assert.equal(url.origin,'https://www.googleapis.com');
  if(fake.hook){const result=await fake.hook(url,init);if(result)return result;}
  if(url.pathname==='/upload/drive/v3/files'){
   assert.equal(init.method,'POST');assert.equal(url.searchParams.get('uploadType'),'multipart');
   const boundary=init.headers['Content-Type'].split('boundary=')[1];const parts=dec.decode(init.body).split('--'+boundary);
   const meta=JSON.parse(parts[1].split('\r\n\r\n')[1]);const text=parts[2].split('\r\n\r\n')[1].slice(0,-2);
   const id='file'+(++counter),item={...meta,id,trashed:false};items.set(id,item);bodies.set(id,enc.encode(text));return Response.json(item);
  }
  assert.equal(init.method,'GET');
  if(url.pathname==='/drive/v3/files'){
   assert.equal(url.searchParams.get('pageSize'),'2');const name=url.searchParams.get('q').match(/name = '([^']+)'/)[1];return Response.json({files:[...items.values()].filter(x=>x.name===name&&x.parents[0]==='archive'&&!x.trashed)});
  }
  const id=url.pathname.split('/').at(-1);assert.ok(items.has(id));return url.searchParams.get('alt')==='media'?new Response(bodies.get(id)):Response.json(items.get(id));
 };
 fake.sink=()=>createDriveArchiveSink({authenticatedFetch:fake.fetch,categoryId:'category',archiveFolderId:'archive'});
 return fake;
}
const payload=enc.encode('{"fixture":true}\n'),name='object-'+hash(payload)+'.json';
test('create/read/reuse is immutable and only touches verified folder ancestry',async()=>{
 const d=drive(),sink=d.sink();const result=await sink.saveImmutable(name,payload);assert.equal(result.status,'created_verified');assert.deepEqual(await sink.read(result.id,payload.length),payload);
 const again=await d.sink().saveImmutable(name,payload);assert.deepEqual(again,{id:result.id,status:'existing_verified'});assert.equal(d.bodies.size,1);assert.equal(d.calls.filter(x=>x.method==='POST').length,1);assert.ok(sink.snapshot().requests<=DRIVE_LIMITS.requests);
});
test('wrong root/category/destination and content-address mismatch fail before upload',async()=>{
 for(const id of [DRIVE_ROOT,'category','archive']){const d=drive();d.items.get(id).name='unexpected';await assert.rejects(()=>d.sink().saveImmutable(name,payload),/SCOPE/);assert.equal(d.bodies.size,0);}
 const d=drive();await assert.rejects(()=>d.sink().saveImmutable('object-'+'0'.repeat(64)+'.json',payload),/NAME_HASH/);assert.equal(d.calls.length,0);
});
test('duplicate matches and pagination fail closed without uploads',async()=>{
 for(const paginated of [true,false]){const d=drive();d.hook=url=>url.pathname==='/drive/v3/files'?Response.json(paginated?{files:[],nextPageToken:'more'}:{files:[{},{}]}):null;await assert.rejects(()=>d.sink().saveImmutable(name,payload),/AMBIGUOUS/);assert.equal(d.bodies.size,0);}
});
test('existing altered bytes, moved object, and corrupt readback fail closed',async()=>{
 for(const kind of ['bytes','parent','mime']){const d=drive();const saved=await d.sink().saveImmutable(name,payload);
  if(kind==='bytes')d.bodies.set(saved.id,enc.encode('x'.repeat(payload.length)));if(kind==='parent')d.items.get(saved.id).parents=['outside'];if(kind==='mime')d.items.get(saved.id).mimeType='text/plain';
  const sink=d.sink();if(kind==='parent'){d.hook=url=>url.pathname==='/drive/v3/files'?Response.json({files:[d.items.get(saved.id)]}):null;}
  await assert.rejects(()=>sink.saveImmutable(name,payload),/COLLISION|SCOPE/);assert.equal(d.bodies.size,1);
 }
});
test('metadata cap, HTTP redirects/errors and uncertain POST failures never retry',async()=>{
 for(const kind of ['large','redirect','rate-limit','post']){const d=drive();d.hook=(url,init)=>{
  if(kind==='post'){if(init.method==='POST')throw Error('network failed');return null;}
  return kind==='large'?new Response('x'.repeat(DRIVE_LIMITS.metadataBytes+1)):new Response('',{status:kind==='redirect'?302:429});
 };const sink=d.sink();await assert.rejects(()=>sink.saveImmutable(name,payload));const count=d.calls.length;await assert.rejects(()=>sink.saveImmutable(name,payload),/STOPPED/);assert.equal(d.calls.length,count);
 }
});
test('foreign read IDs and excessive file caps never send requests',async()=>{
 const d=drive(),sink=d.sink();await assert.rejects(()=>sink.read('foreign',100),/NOT_APPROVED/);assert.equal(d.calls.length,0);
});
test('streamed overflow cancels body and permanently stops adapter',async()=>{
 const d=drive();let cancelled=false;d.hook=()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(20000));},cancel(){cancelled=true;}}));
 const sink=d.sink();await assert.rejects(()=>sink.saveImmutable(name,payload),/RESPONSE_CAP/);assert.equal(cancelled,true);assert.equal(sink.snapshot().closed,true);
});
test('request and cumulative transfer limits apply across adapter operations',async()=>{
 const d=drive(),sink=d.sink();const saved=await sink.saveImmutable(name,payload);
 await assert.rejects(async()=>{for(let i=0;i<30;i++)await sink.read(saved.id,payload.length);},/REQUEST_CAP/);assert.equal(d.calls.length,DRIVE_LIMITS.requests);
 const e=drive(),other=e.sink();const big=enc.encode('"'+'x'.repeat(350000)+'"');const created=await other.saveImmutable('object-'+hash(big)+'.json',big);
 await assert.rejects(async()=>{for(let i=0;i<10;i++)await other.read(created.id,big.length);},/TRANSFER_CAP/);assert.equal(other.snapshot().closed,true);
});
test('full zero-LIST R2 to Drive fixture roundtrip, rerun and independent readback',async()=>{
 const d=drive(),raw=enc.encode('{"segments":["must-not-traverse"]}');
 const plan={contract:'fbis-known-key-plan-v1',batchId:'offline',bucket:'fbis-archive',objects:[{key:'research/offline/manifest.json',bytes:raw.length,records:0,sha256:hash(raw),format:'json-document',sport:'CFB',provider:'fixture',season:'2004',schemaVersion:'fixture-v1',capturedAt:'2026-10-15T00:00:00Z'}]};
 const calls=[];const bucket={head:async()=>{calls.push('head');return{size:raw.length,etag:'stable'};},get:async()=>{calls.push('get');return{size:raw.length,etag:'stable',body:new Response(raw).body};},list(){assert.fail('R2 LIST forbidden');}};
 const env={CLOUDFLARE_ACCOUNT_ID:'fixture',FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async({id})=>({allowed:true,job:JOB,id,expiresAtMs:Date.now()+110000,maxUnits:{r2Reads:2,r2Bytes:raw.length,r2Lists:0,r2Writes:0,d1Queries:0,reads:0,writes:0}})})}};
 const first=await archiveKnownKeys({env,bucket,plan,sink:d.sink(),reservationId:'one'});
 const second=await archiveKnownKeys({env,bucket,plan,sink:d.sink(),reservationId:'two'});
 assert.equal(first.manifestId,second.manifestId);assert.equal(d.bodies.size,2);assert.equal(second.manifest.totalRecords,0);assert.equal(second.referencedRecordsVerified,false);assert.deepEqual(calls,['head','get','head','get']);assert.equal(second.independentRestoreVerified,true);
});
test('lost upload response is not retried; fresh adapter discovers completed immutable upload',async()=>{
 const d=drive(),transport=d.fetch;let failed=false;
 const sink=createDriveArchiveSink({categoryId:'category',archiveFolderId:'archive',authenticatedFetch:async(url,init)=>{
  const result=await transport(url,init);if(init.method==='POST'&&!failed){failed=true;throw Error('response lost');}return result;
 }});
 await assert.rejects(()=>sink.saveImmutable(name,payload),/OUTCOME_UNCERTAIN/);assert.equal(d.bodies.size,1);
 const result=await d.sink().saveImmutable(name,payload);assert.equal(result.status,'existing_verified');assert.equal(d.calls.filter(x=>x.method==='POST').length,1);
});
test('expired and concurrent adapter invocations fail closed',async()=>{
 const d=drive();let time=0;const sink=createDriveArchiveSink({authenticatedFetch:d.fetch,categoryId:'category',archiveFolderId:'archive',now:()=>time});time=110000;await assert.rejects(()=>sink.saveImmutable(name,payload),/EXPIRED/);assert.equal(d.calls.length,0);
 const e=drive(),other=e.sink();const first=other.saveImmutable(name,payload);await assert.rejects(()=>other.saveImmutable(name,payload),/CONCURRENT/);await assert.rejects(()=>first,/STOPPED/);assert.equal(e.bodies.size,0);
});
test('two maximum-total source fixtures fit request and byte caps end to end',async()=>{
 const d=drive(),raw=enc.encode(JSON.stringify({payload:'x'.repeat(204000)}));
 const object={bytes:raw.length,records:0,sha256:hash(raw),format:'json-document',sport:'CFB',provider:'fixture',season:'2004',schemaVersion:'fixture-v1',capturedAt:'2026-10-15T00:00:00Z'};
 const plan={contract:'fbis-known-key-plan-v1',batchId:'max-fixture',bucket:'fbis-archive',objects:[{...object,key:'research/a.json'},{...object,key:'research/b.json'}]};
 const bucket={head:async()=>({size:raw.length,etag:'stable'}),get:async()=>({size:raw.length,etag:'stable',body:new Response(raw).body})};
 const env={CLOUDFLARE_ACCOUNT_ID:'fixture',FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async({id})=>({allowed:true,job:JOB,id,expiresAtMs:Date.now()+110000,maxUnits:{r2Reads:4,r2Bytes:raw.length*2,r2Lists:0,r2Writes:0,d1Queries:0,reads:0,writes:0}})})}};
 const sink=d.sink();const result=await archiveKnownKeys({env,bucket,plan,sink,reservationId:'maximum'});
 assert.equal(result.independentRestoreVerified,true);assert.equal(sink.snapshot().requests,21);assert.ok(sink.snapshot().transferred<DRIVE_LIMITS.totalBytes);assert.equal(d.bodies.size,3);
});
test('known-ID oversized read cap is rejected without another network request',async()=>{
 const d=drive(),sink=d.sink();const saved=await sink.saveImmutable(name,payload);const count=d.calls.length;
 await assert.rejects(()=>sink.read(saved.id,DRIVE_LIMITS.fileBytes+1),/NOT_APPROVED/);assert.equal(d.calls.length,count);
});
test('deadline during pending response or body consumption cancels and stops',async()=>{
 for(const stage of ['response','body']){
  const d=drive();let time=0,cancelled=false;
  const sink=createDriveArchiveSink({categoryId:'category',archiveFolderId:'archive',now:()=>time,authenticatedFetch:async()=>{
   if(stage==='response')time=110000;
   return new Response(new ReadableStream({pull(c){if(stage==='body')time=110000;c.enqueue(enc.encode('{}'));},cancel(){cancelled=true;}}));
  }});
  await assert.rejects(()=>sink.saveImmutable(name,payload),/EXPIRED/);assert.equal(cancelled,true);assert.equal(sink.snapshot().closed,true);
 }
});
test('POST HTTP and malformed response failures are classified uncertain and never retried',async()=>{
 for(const response of [()=>new Response('',{status:500}),()=>new Response('{'),()=>new Response('{}',{headers:{'content-length':'100'}})]){
  const d=drive();d.hook=(_url,init)=>init.method==='POST'?response():null;const sink=d.sink();await assert.rejects(()=>sink.saveImmutable(name,payload),/UPLOAD_OUTCOME_UNCERTAIN/);assert.equal(d.calls.filter(x=>x.method==='POST').length,1);assert.equal(sink.snapshot().closed,true);
 }
});
