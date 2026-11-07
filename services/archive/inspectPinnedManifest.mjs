// Exact read-only qualification evidence. No caller-supplied key or upload path.
import {requireJobAdmission} from '../account-budget/admission.mjs';
import {createExecutionLease,executionR2} from '../account-budget/execution.mjs';
import {PINNED_INSPECTION_JOB,CERTIFIED_EXECUTION_JOBS} from '../account-budget/executionJobs.mjs';
export const PINNED_MANIFEST=Object.freeze({bucket:'fbis-archive',key:'research/storage-recovery/2026-10-15/cfb-roster-2004-pilot/manifest-9dca1afc000cd6951769f92b74f7c45381f117ac51d995c07caf97f4b4ac2f38.json',bytes:2456,sha256:'9dca1afc000cd6951769f92b74f7c45381f117ac51d995c07caf97f4b4ac2f38'});
export const INSPECTION_RESERVATION_ID='fbis-pinned-manifest-inspection-v1';
export async function inspectPinnedManifest(env){
 if(!env?.R2_ARCHIVE)throw Error('PINNED_INSPECTION_BINDING_REQUIRED');
 const grant=await requireJobAdmission(env,PINNED_INSPECTION_JOB,INSPECTION_RESERVATION_ID);
 if(grant.id!==INSPECTION_RESERVATION_ID||grant.job!==PINNED_INSPECTION_JOB)throw Error('PINNED_INSPECTION_ADMISSION_IDENTITY');
 const caps=CERTIFIED_EXECUTION_JOBS[PINNED_INSPECTION_JOB].units;
 if(Object.keys(grant.maxUnits||{}).length!==Object.keys(caps).length||Object.entries(caps).some(([key,value])=>grant.maxUnits[key]!==value))throw Error('PINNED_INSPECTION_EXACT_UNITS');
 const lease=createExecutionLease(grant);
 // Logical coordinator work already executed before this lease was returned.
 // Dollar reservation includes its separately approved overhead component.
 lease.spend({inspectionAttempts:1,coordinatorCalls:1,coordinatorStorageGets:2,coordinatorStoragePuts:2});
 const source=executionR2(env.R2_ARCHIVE,lease);
 const head=await source.head(PINNED_MANIFEST.key);lease.live();
 if(!head||head.size!==PINNED_MANIFEST.bytes||typeof head.etag!=='string'||!head.etag)lease.stop('PINNED_INSPECTION_HEAD_MISMATCH');
 const object=await source.get(PINNED_MANIFEST.key,{onlyIf:{etagMatches:head.etag}});lease.live();
 if(!object||object.size!==PINNED_MANIFEST.bytes||object.etag!==head.etag||!object.body){await object?.body?.cancel().catch(()=>{});lease.stop('PINNED_INSPECTION_SOURCE_CHANGED');}
 const reader=object.body.getReader();const chunks=[];let size=0;
 try{while(true){lease.live();const part=await reader.read();lease.live();if(part.done)break;size+=part.value.byteLength;if(size>4096)lease.stop('PINNED_INSPECTION_STREAM_CAP');chunks.push(part.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(size!==PINNED_MANIFEST.bytes)lease.stop('PINNED_INSPECTION_LENGTH_MISMATCH');
 const raw=new Uint8Array(size);let offset=0;for(const part of chunks){raw.set(part,offset);offset+=part.length;}
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
 if(sha!==PINNED_MANIFEST.sha256)lease.stop('PINNED_INSPECTION_HASH_MISMATCH');
 let document;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{lease.stop('PINNED_INSPECTION_JSON_INVALID');}
 if(document===null||typeof document!=='object'||Array.isArray(document))lease.stop('PINNED_INSPECTION_DOCUMENT_REQUIRED');
 lease.live();return{contract:'fbis-pinned-manifest-inspection-v1',source:PINNED_MANIFEST,document,budget:lease.snapshot(),restoredRecords:0,sourceUnchanged:true,archiveCreated:false,productionAuthority:false,sourceDeletionAuthorized:false};
}
