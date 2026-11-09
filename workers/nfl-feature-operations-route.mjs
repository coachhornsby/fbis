import {verifyNflScopedGithubIdentity} from '../services/nfl/scopedGithubIdentity.mjs';
import {writeNflProjectionPacket,verifyNflProjectionPacket,inspectNflProjectionPacket} from '../services/nfl/writeProjectionPacket.mjs';
import {inspectNflFeatureSnapshot,verifyNflFeatureSnapshot} from '../services/nfl/inspectFeatureSnapshot.mjs';
import {writeNflFeatureSnapshot} from '../services/nfl/writeFeatureSnapshot.mjs';
const paths=new Map([['/api/nfl/projections/inspect','inspect-output'],['/api/nfl/projections/publish','publish-output'],['/api/nfl/projections/verify','verify-output'],['/api/nfl/features/inspect','inspect'],['/api/nfl/features/publish','publish'],['/api/nfl/features/verify','verify']]);
const response=(status,body)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function bodyBytes(request,max){
 if(!request.body)return new Uint8Array();
 const reader=request.body.getReader(),parts=[];let size=0;
 const deadline=Date.now()+5000;
 try{while(true){const remaining=deadline-Date.now();if(remaining<=0)throw Error('BODY_TIMEOUT');let timer;
 const part=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('BODY_TIMEOUT')),remaining);})]).finally(()=>clearTimeout(timer));
 if(part.done)break;size+=part.value.length;if(size>max)throw Error('BODY_LIMIT');parts.push(part.value);}}
 finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
export async function handleNflFeatureOperation(request,env){
 const url=new URL(request.url),operation=paths.get(url.pathname);if(!operation)return null;
 if(env.FBIS_NFL_FEATURE_OPERATIONS_ENABLED!=='true')return response(404,{error:'NFL_OPERATIONS_DISABLED'});
 if(request.method!=='POST'||url.search)return response(400,{error:'NFL_REQUEST_INVALID'});
 const auth=request.headers.get('authorization')||'';
 let identity=null;
 if(env.FBIS_NFL_OIDC_GRANT){
  let grant;try{grant=JSON.parse(env.FBIS_NFL_OIDC_GRANT);}catch{return response(401,{error:'unauthorized'});}
  identity=await verifyNflScopedGithubIdentity(auth.startsWith('Bearer ')?auth.slice(7):'',grant);
  if(!identity)return response(401,{error:'unauthorized'});
  // Propagate expiration to admission and storage, not just initial authentication.
  try{env=scopeNflOperationLifetime(env,identity.expiresAt,identity.outputDate);}catch{return response(403,{error:'NFL_SCOPE_CONFIGURATION_MISMATCH'});}
 }else{
  const secret=env.ORCH_CONTROL_TOKEN;
  if(typeof secret!=='string'||secret.length<32||secret.length>256||auth.length>263||auth!=='Bearer '+secret)return response(401,{error:'unauthorized'});
 }
 // This declaration MUST be checked against actual deployed limits before release;
 // it is not a substitute for platform CPU enforcement.
 if(env.FBIS_NFL_RUNTIME_CPU_MS!=='100')return response(503,{error:'NFL_RUNTIME_LIMIT_NOT_APPROVED'});
 try{
  const raw=await bodyBytes(request,operation==='publish-output'?512000:operation==='publish'?9*1024*1024:0);
  if(operation==='inspect-output')return response(200,await inspectNflProjectionPacket(env));
  if(operation==='publish-output')return response(200,await writeNflProjectionPacket(env,{packetText:new TextDecoder('utf-8',{fatal:true}).decode(raw)}));
  if(operation==='verify-output')return response(200,await verifyNflProjectionPacket(env));
  if(operation==='inspect')return response(200,await inspectNflFeatureSnapshot(env));
  if(operation==='verify')return response(200,await verifyNflFeatureSnapshot(env));
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(Object.keys(input).sort().join(',')!=='receipt,season,snapshotText')return response(400,{error:'NFL_PUBLICATION_INPUT_INVALID'});
  const envelope=JSON.stringify({schema:'nfl-feature-publication-v1',snapshotText:input.snapshotText,receipt:input.receipt});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(envelope))),x=>x.toString(16).padStart(2,'0')).join('');
  if(!/^[a-f0-9]{64}$/.test(env.FBIS_NFL_APPROVED_PUBLICATION_SHA256||'')||hash!==env.FBIS_NFL_APPROVED_PUBLICATION_SHA256)return response(403,{error:'NFL_PUBLICATION_NOT_APPROVED'});
  return response(200,await writeNflFeatureSnapshot(env,input));
 }catch{return response(503,{error:'NFL_OPERATION_FAILED_NO_RETRY'});}
}

export function scopeNflOperationLifetime(env,expiresAt,outputDate){
 const check=()=>{if(!Number.isSafeInteger(expiresAt)||Date.now()>=expiresAt)throw Error('NFL_AUTHORIZATION_EXPIRED');};check();
 if(typeof outputDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(outputDate)||!Number.isFinite(Date.parse(outputDate+'T12:00:00Z'))||new Date(outputDate+'T12:00:00Z').toISOString().slice(0,10)!==outputDate)throw Error('NFL_AUTHORIZATION_DATE_INVALID');
 if(env.FBIS_NFL_PACKET_INSPECTION_DATE&&env.FBIS_NFL_PACKET_INSPECTION_DATE!==outputDate)throw Error('NFL_AUTHORIZATION_DATE_MISMATCH');
 if(env.FBIS_NFL_PACKET_WRITE_APPROVAL){let a;try{a=JSON.parse(env.FBIS_NFL_PACKET_WRITE_APPROVAL);}catch{throw Error('NFL_AUTHORIZATION_DATE_MISMATCH');}if(a?.date!==outputDate)throw Error('NFL_AUTHORIZATION_DATE_MISMATCH');}
 const keys=new Set(['nfl/features/latest.json',`private/nfl/projections/${outputDate}.json`]);
 const bucket=env.R2_ARCHIVE,coordinator=env.FBIS_ACCOUNT_BUDGET;
 const scoped={...env,FBIS_NFL_PACKET_INSPECTION_DATE:outputDate};
 if(bucket)scoped.R2_ARCHIVE=Object.fromEntries(['get','head','put'].filter(k=>typeof bucket[k]==='function').map(k=>[k,async(...args)=>{check();if(!keys.has(args[0]))throw Error('NFL_AUTHORIZATION_KEY_BLOCKED');return bucket[k](...args);} ]));
 if(coordinator)scoped.FBIS_ACCOUNT_BUDGET={getByName(name){check();const stub=coordinator.getByName(name);return {async reserve(request){check();const result=await stub.reserve(request);check();return result;}};}};
 return scoped;
}
