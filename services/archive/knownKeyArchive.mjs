// Offline-tested building block only. No route, schedule, policy entry, or credentials.
// Live execution remains blocked until this job is separately certified and admitted.
import {requireJobAdmission} from '../account-budget/admission.mjs';
import {createExecutionLease,executionR2} from '../account-budget/execution.mjs';
export const JOB='services/archive/knownKeyArchive.mjs';
export const LIMITS=Object.freeze({objects:2,objectBytes:262144,totalBytes:409600,envelopeBytes:360448,manifestBytes:16384});
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const bytes=value=>encoder.encode(JSON.stringify(value)+'\n');
const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
const fail=reason=>{throw Error(reason);};
function records(raw,format){
 const text=decoder.decode(raw);
 const result=format==='ndjson'?text.trim().split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line)):JSON.parse(text);
 if(!Array.isArray(result)||!result.every(row=>row!==null&&typeof row==='object'&&!Array.isArray(row)))fail('ARCHIVE_RECORD_FORMAT');
 return result;
}
function planSnapshot(plan){
 const copy=JSON.parse(JSON.stringify(plan));
 if(copy?.contract!=='fbis-known-key-plan-v1'||copy.bucket!=='fbis-archive'||!Array.isArray(copy.objects)||copy.objects.length<1||copy.objects.length>LIMITS.objects)fail('ARCHIVE_PLAN_INVALID');
 if(!/^[a-z0-9-]{1,64}$/.test(copy.batchId||''))fail('ARCHIVE_BATCH_ID_INVALID');
 const keys=new Set();let total=0;
 for(const o of copy.objects){
  if(typeof o.key!=='string'||!o.key.startsWith('research/')||o.key.length>1024||/[\x00-\x1f\\]/.test(o.key)||o.key.split('/').some(s=>s==='..'||s==='.')||keys.has(o.key))fail('ARCHIVE_KEY_INVALID');
  keys.add(o.key);
  if(!Number.isSafeInteger(o.bytes)||o.bytes<1||o.bytes>LIMITS.objectBytes||!Number.isSafeInteger(o.records)||o.records<1||o.records>10000||!['json-array','ndjson'].includes(o.format)||!/^[a-f0-9]{64}$/.test(o.sha256||''))fail('ARCHIVE_EXPECTATION_INVALID');
  for(const field of ['sport','provider','season','schemaVersion','capturedAt'])if(typeof o[field]!=='string'||!o[field]||o[field].length>100)fail('ARCHIVE_PROVENANCE_REQUIRED');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(o.capturedAt)||!Number.isFinite(Date.parse(o.capturedAt)))fail('ARCHIVE_TIMESTAMP_INVALID');
  total+=o.bytes;
 }
 if(total>LIMITS.totalBytes)fail('ARCHIVE_TOTAL_CAP');
 copy.objects.sort((a,b)=>a.key.localeCompare(b.key));
 return copy;
}
async function readStream(object,expected,lease){
 if(!object?.body?.getReader)fail('ARCHIVE_BODY_REQUIRED');
 const reader=object.body.getReader();let size=0;const chunks=[];
 try{while(true){lease.live();const part=await reader.read();lease.live();if(part.done)break;size+=part.value.byteLength;if(size>expected)fail('ARCHIVE_STREAM_CAP');chunks.push(part.value);}if(size!==expected)fail('ARCHIVE_LENGTH_CHANGED');}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const result=new Uint8Array(size);let offset=0;for(const part of chunks){result.set(part,offset);offset+=part.length;}return result;
}
function base64(raw){let text='';for(let i=0;i<raw.length;i+=8192)text+=String.fromCharCode(...raw.subarray(i,i+8192));return btoa(text);}
function unbase64(value){if(typeof value!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail('ARCHIVE_ENCODING_INVALID');return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
async function sinkRead(sink,id,cap,lease){
 lease.live();const data=await sink.read(id,cap);lease.live();
 if(!(data instanceof Uint8Array)||data.byteLength>cap)fail('ARCHIVE_READBACK_CAP');return data;
}

export async function archiveKnownKeys({env,bucket,plan,sink,reservationId}){
 // Clone and validate before reservation. Never let an asynchronous caller mutate
 // the admitted key set, source expectations, or provenance in flight.
 const frozenPlan=planSnapshot(plan);
 if(!sink?.saveImmutable||!sink?.read)fail('IMMUTABLE_SINK_REQUIRED');
 const admission=await requireJobAdmission(env,JOB,reservationId);
 if(admission.job!==JOB||admission.id!==reservationId)fail('ARCHIVE_ADMISSION_IDENTITY');
 const lease=createExecutionLease(admission);
 const total=frozenPlan.objects.reduce((sum,o)=>sum+o.bytes,0);
 const units=admission.maxUnits;
 for(const unit of ['r2Lists','r2Writes','d1Queries','reads','writes'])if(units[unit]!==0)fail('ARCHIVE_ZERO_MUTATION_BUDGET_REQUIRED');
 if(units.r2Reads!==2*frozenPlan.objects.length||units.r2Bytes!==total)fail('ARCHIVE_EXACT_READ_BUDGET_REQUIRED');
 const source=executionR2(bucket,lease);const metadata=[];
 // All metadata must pass before any object download or destination write.
 for(const item of frozenPlan.objects){
  const head=await source.head(item.key);lease.live();
  if(!head||head.size!==item.bytes||typeof head.etag!=='string'||!head.etag)fail('ARCHIVE_HEAD_MISMATCH');
  metadata.push({etag:head.etag});
 }
 const packages=[];
 for(let i=0;i<frozenPlan.objects.length;i++){
  const item=frozenPlan.objects[i],etag=metadata[i].etag;
  const object=await source.get(item.key,{onlyIf:{etagMatches:etag}});lease.live();
  if(!object||object.size!==item.bytes||object.etag!==etag||!object.body){await object?.body?.cancel().catch(()=>{});fail('ARCHIVE_SOURCE_CHANGED');}
  const raw=await readStream(object,item.bytes,lease);
  if(await hash(raw)!==item.sha256)fail('ARCHIVE_SOURCE_HASH');
  if(records(raw,item.format).length!==item.records)fail('ARCHIVE_RECORD_COUNT');
  const envelope=bytes({contract:'fbis-known-key-envelope-v1',source:item,encoding:'base64',payload:base64(raw)});
  if(envelope.length>LIMITS.envelopeBytes)fail('ARCHIVE_ENVELOPE_CAP');
  packages.push({item,raw,envelope,envelopeSha256:await hash(envelope)});
 }
 const files=[];const operations=[];
 // The destination adapter must implement immutable create-or-verified-reuse and
 // bounded reads. No overwrite/delete method exists in this interface.
 for(const p of packages){
  lease.live();const saved=await sink.saveImmutable('object-'+p.envelopeSha256+'.json',p.envelope);lease.live();
  if(typeof saved?.id!=='string'||!saved.id||!['created_verified','existing_verified'].includes(saved.status))fail('ARCHIVE_SAVE_RECEIPT');
  operations.push(saved.status);
  files.push({...p.item,driveId:saved.id,archiveBytes:p.envelope.length,archiveSha256:p.envelopeSha256});
 }
 const manifest={contract:'fbis-known-key-manifest-v1',batchId:frozenPlan.batchId,bucket:frozenPlan.bucket,files,totalSourceBytes:total,totalRecords:files.reduce((s,f)=>s+f.records,0),compression:'none',cloudflareD1Queries:0,r2Lists:0,productionAuthority:false,sourceDeletionAuthorized:false,retentionReleaseAuthorized:false};
 const manifestBytes=bytes(manifest);if(manifestBytes.length>LIMITS.manifestBytes)fail('ARCHIVE_MANIFEST_CAP');
 lease.live();const manifestSha256=await hash(manifestBytes);
 const saved=await sink.saveImmutable('manifest-'+manifestSha256+'.json',manifestBytes);lease.live();
 if(typeof saved?.id!=='string'||!saved.id)fail('ARCHIVE_MANIFEST_RECEIPT');
 const remoteBytes=await sinkRead(sink,saved.id,LIMITS.manifestBytes,lease);
 if(await hash(remoteBytes)!==manifestSha256)fail('ARCHIVE_MANIFEST_READBACK');
 const restoredManifest=JSON.parse(decoder.decode(remoteBytes));
 let restoredRecords=0;
 for(const file of restoredManifest.files){
  const remote=await sinkRead(sink,file.driveId,LIMITS.envelopeBytes,lease);
  if(remote.length!==file.archiveBytes||await hash(remote)!==file.archiveSha256)fail('ARCHIVE_ENVELOPE_READBACK');
  const envelope=JSON.parse(decoder.decode(remote));
  const restored=unbase64(envelope.payload);
  if(envelope.contract!=='fbis-known-key-envelope-v1'||envelope.encoding!=='base64'||restored.length!==file.bytes||await hash(restored)!==file.sha256)fail('ARCHIVE_SOURCE_READBACK');
  const count=records(restored,file.format).length;if(count!==file.records)fail('ARCHIVE_RESTORE_COUNT');restoredRecords+=count;
 }
 if(restoredRecords!==restoredManifest.totalRecords)fail('ARCHIVE_RESTORE_TOTAL');
 return {manifestId:saved.id,manifestSha256,manifest:restoredManifest,operations,independentRestoreVerified:true,budget:lease.snapshot()};
}
