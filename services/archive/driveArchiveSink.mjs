// Credential-free adapter. A future approved caller supplies authenticatedFetch.
// No refresh-token storage, folder creation, overwrites, deletes, or automatic retry.
export const DRIVE_ROOT='1-cEe24VMCvfO55HZry5qxRaf0riTs6NO';
export const DRIVE_LIMITS=Object.freeze({requests:24,totalBytes:2097152,metadataBytes:16384,fileBytes:360448,durationMs:110000});
const BASE='https://www.googleapis.com/drive/v3/files';
const UPLOAD='https://www.googleapis.com/upload/drive/v3/files';
const FOLDER='application/vnd.google-apps.folder';
const fields='id,name,mimeType,parents,trashed';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(id);
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),x=>x.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);

export function createDriveArchiveSink({authenticatedFetch,categoryId,archiveFolderId,now=Date.now,executionLease}){
 if(typeof authenticatedFetch!=='function'||!validId(categoryId)||!validId(archiveFolderId)||new Set([DRIVE_ROOT,categoryId,archiveFolderId]).size!==3)throw Error('DRIVE_SINK_CONFIG');
 if(executionLease!==undefined&&(!executionLease?.live||!executionLease?.spend||!executionLease?.stop||!Number.isSafeInteger(executionLease.expiresAtMs)))throw Error('DRIVE_EXECUTION_LEASE_INVALID');
 const started=now();let requests=0,transferred=0,closed=false,busy=false,scoped=false;
 const known=new Map();
 const stop=code=>{closed=true;if(executionLease)executionLease.stop(code);throw Error(code);};
 const live=()=>{executionLease?.live();if(closed||now()-started>=DRIVE_LIMITS.durationMs)stop('DRIVE_SINK_EXPIRED_OR_STOPPED');};
 const spend=amount=>{live();if(!Number.isSafeInteger(amount)||amount<0||transferred+amount>DRIVE_LIMITS.totalBytes)stop('DRIVE_TRANSFER_CAP');transferred+=amount;};
 async function request(url,{method='GET',body,headers={}}={},cap=DRIVE_LIMITS.metadataBytes){
  live();if(requests>=DRIVE_LIMITS.requests)stop('DRIVE_REQUEST_CAP');requests++;
  if(body)spend(body.length);
  executionLease?.spend({requests:1});
  let response;
  try{response=await authenticatedFetch(url,{method,body,headers,redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(20000,DRIVE_LIMITS.durationMs-(now()-started),executionLease?executionLease.expiresAtMs-now():Infinity)))});}
  catch{stop('DRIVE_REQUEST_FAILED_OUTCOME_UNCERTAIN');}
  try{live();}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  if(response.status!==200&&!(method==='POST'&&response.status===201)){await response.body?.cancel().catch(()=>{});stop('DRIVE_HTTP_'+response.status);}
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>cap)){await response.body?.cancel().catch(()=>{});stop('DRIVE_RESPONSE_CAP');}
  if(!response.body)stop('DRIVE_RESPONSE_BODY_REQUIRED');
  const reader=response.body.getReader();let count=0;const chunks=[];
  try{while(true){live();const part=await reader.read();live();if(part.done)break;count+=part.value.length;if(count>cap)stop('DRIVE_RESPONSE_CAP');spend(part.value.length);executionLease?.spend({responseBytes:part.value.length});chunks.push(part.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const result=new Uint8Array(count);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}
  if(declared!==null&&count!==Number(declared))stop('DRIVE_RESPONSE_TRUNCATED');return result;
 }
 async function json(url,init){try{return JSON.parse(decoder.decode(await request(url,init)));}catch(error){closed=true;if(init?.method==='POST')stop('DRIVE_UPLOAD_OUTCOME_UNCERTAIN');if(error instanceof SyntaxError||error instanceof TypeError)stop('DRIVE_JSON_INVALID');throw error;}}
 const url=(base,params)=>base+'?'+new URLSearchParams(params);
 async function metadata(id){return json(url(BASE+'/'+id,{fields,supportsAllDrives:'true'}));}
 function check(item,{id,name,mimeType,parent}){
  if(!item||item.id!==id||item.name!==name||item.mimeType!==mimeType||item.trashed!==false||(parent&&(!Array.isArray(item.parents)||item.parents.length!==1||item.parents[0]!==parent)))stop('DRIVE_METADATA_SCOPE_MISMATCH');
 }
 async function scope(){
  if(scoped)return;
  check(await metadata(DRIVE_ROOT),{id:DRIVE_ROOT,name:'FBIS_Data',mimeType:FOLDER});
  check(await metadata(categoryId),{id:categoryId,name:'04_Model_Evidence',mimeType:FOLDER,parent:DRIVE_ROOT});
  check(await metadata(archiveFolderId),{id:archiveFolderId,name:'Known_Key_Archive',mimeType:FOLDER,parent:categoryId});
  scoped=true;
 }
 async function readKnown(id,cap){
  if(!known.has(id)||!Number.isSafeInteger(cap)||cap<1||cap>DRIVE_LIMITS.fileBytes)stop('DRIVE_READ_NOT_APPROVED');
  const name=known.get(id);
  check(await metadata(id),{id,name,mimeType:'application/json',parent:archiveFolderId});
  return request(url(BASE+'/'+id,{alt:'media'}),{},cap);
 }
 async function exclusive(action){
  live();if(busy)stop('DRIVE_CONCURRENT_CALL');busy=true;
  try{return await action();}catch(error){closed=true;const code=/^(DRIVE_[A-Z0-9_]+|JOB_[A-Za-z0-9_]+)$/.test(error?.message||'')?error.message:'DRIVE_OPERATION_FAILED';if(executionLease)executionLease.stop(code);throw Error(code);}finally{busy=false;}
 }
 return Object.freeze({
  async saveImmutable(name,payload){return exclusive(async()=>{
   if(!(payload instanceof Uint8Array)||payload.length<1||payload.length>DRIVE_LIMITS.fileBytes||!/^(object|manifest)-[a-f0-9]{64}\.json$/.test(name))stop('DRIVE_PAYLOAD_INVALID');
   // Snapshot caller bytes before any await and verify the content-addressed name.
   const data=payload.slice();if(name.slice(name.indexOf('-')+1,-5)!==await sha(data))stop('DRIVE_NAME_HASH_MISMATCH');
   await scope();
   const listed=await json(url(BASE,{q:`'${archiveFolderId}' in parents and name = '${name}' and trashed = false`,fields:`nextPageToken,files(${fields})`,pageSize:'2',spaces:'drive'}));
   if(listed.nextPageToken||!Array.isArray(listed.files)||listed.files.length>1)stop('DRIVE_AMBIGUOUS_OBJECT');
   let id,status;
   if(listed.files.length){const item=listed.files[0];if(!validId(item.id))stop('DRIVE_OBJECT_ID_INVALID');id=item.id;check(item,{id,name,mimeType:'application/json',parent:archiveFolderId});status='existing_verified';}
   else{
    const boundary='fbis_archive_'+crypto.randomUUID().replaceAll('-','');
    const meta=JSON.stringify({name,mimeType:'application/json',parents:[archiveFolderId]});
    const start=encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`);
    const end=encoder.encode(`\r\n--${boundary}--\r\n`);const body=new Uint8Array(start.length+data.length+end.length);body.set(start);body.set(data,start.length);body.set(end,start.length+data.length);
    const item=await json(url(UPLOAD,{uploadType:'multipart',fields,supportsAllDrives:'true'}),{method:'POST',body,headers:{'Content-Type':'multipart/related; boundary='+boundary}});
    if(!validId(item?.id))stop('DRIVE_OBJECT_ID_INVALID');id=item.id;check(item,{id,name,mimeType:'application/json',parent:archiveFolderId});status='created_verified';
   }
   known.set(id,name);
   if(!same(await readKnown(id,data.length),data))stop('DRIVE_IMMUTABLE_COLLISION');
   return{id,status};
  });},
  async read(id,cap){return exclusive(()=>readKnown(id,cap));},
  snapshot(){return{requests,transferred,closed,scoped,limits:{...DRIVE_LIMITS}};}
 });
}
