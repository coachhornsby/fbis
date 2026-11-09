// Conditional NFL-only output transport. No inference, provider calls or schedules.
import {requireJobAdmission} from '../account-budget/admission.mjs';
import {createExecutionLease,executionR2} from '../account-budget/execution.mjs';
import {NFL_PACKET_WRITE_JOB as JOB,NFL_PACKET_VERIFY_JOB,NFL_PACKET_INSPECT_JOB,CERTIFIED_EXECUTION_JOBS} from '../account-budget/executionJobs.mjs';
import {validateFourSportPacket} from '../../functions/lib/privateFourSportProjection.js';
import {boardDate} from '../../functions/lib/publicBoardSnapshot.js';
import {NFL_VERIFIED_SOURCE_LABEL} from '../../functions/lib/nflVerifiedRecoveryPacket.js';
export const NFL_PACKET_WRITE_ID='fbis-nfl-output-packet-write-v1';
const MAX=512000;
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const eventTime=(p,e)=>p.eventGeneratedAt?.[String(e.eventId)]??e.generatedAt??p.generatedAt;
export function validateNflPacketTransition(previous,packet,now){
 validateFourSportPacket(packet,{sport:'nfl',date:packet.date});
 if(packet.events.some(e=>typeof e.eventId!=='string')||packet.events.length>32||new Set(packet.events.map(e=>String(e.eventId))).size!==packet.events.length)throw Error('NFL_PACKET_DUPLICATE_OR_EXCESS_EVENTS');
 if(Date.parse(packet.generatedAt)>now||now-Date.parse(packet.generatedAt)>300000||Date.parse(packet.expiresAt)<=now)throw Error('NFL_PACKET_CURRENT_GENERATION_REQUIRED');
 const before=new Map((previous?.events||[]).map(e=>[String(e.eventId),e]));
 if(previous){
  validateFourSportPacket(previous,{sport:'nfl',date:packet.date});
  if(previous.events.some(e=>typeof e.eventId!=='string')||new Set(previous.events.map(e=>String(e.eventId))).size!==previous.events.length)throw Error('NFL_PACKET_PREDECESSOR_DUPLICATE_EVENTS');
  if(Date.parse(previous.expiresAt)<=now||Date.parse(packet.expiresAt)>Date.parse(previous.expiresAt)||Date.parse(packet.generatedAt)<Date.parse(previous.generatedAt))throw Error('NFL_PACKET_EXPIRY_OR_GENERATION_CHANGED');
  for(const old of previous.events){
   const next=packet.events.find(e=>String(e.eventId)===String(old.eventId));
   if(!next)throw Error('NFL_PACKET_EVENT_REMOVAL');
   if(Date.parse(old.start)<=now&&(JSON.stringify(next)!==JSON.stringify(old)||eventTime(packet,next)!==eventTime(previous,old)))throw Error('NFL_PACKET_FROZEN_EVENT_CHANGED');
  }
 }
 let updates=0;
 for(const e of packet.events){
  const old=before.get(String(e.eventId)),same=old&&JSON.stringify(old)===JSON.stringify(e);
  if(same){if(eventTime(packet,e)!==eventTime(previous,old))throw Error('NFL_PACKET_UNCHANGED_EVENT_RESTAMPED');continue;}
  if(boardDate(e.start)!==packet.date||Date.parse(e.start)<=now+120000||eventTime(packet,e)!==packet.generatedAt)throw Error('NFL_PACKET_UPDATE_NOT_FUTURE');
  if(e.projection.modelId!=='NFL-PRO-v1'||e.projection.modelVersion!=='v1.2.1'||e.sourceLabel!==NFL_VERIFIED_SOURCE_LABEL||e.nflVerifiedInput?.source!=='nflverse'||e.nflVerifiedInput.canAuthorizeWager!==false||!hash(e.nflVerifiedInput.snapshotSha256)||e.nflVerifiedInput.observedAt!==e.sourceCapturedAt||e.nflVerifiedInput.dataThrough!==e.sourceDataCutoffAt||Date.parse(e.sourceDataCutoffAt)>Date.parse(e.sourceCapturedAt)||!Number.isFinite(Date.parse(e.sourceDataCutoffAt)))throw Error('NFL_PACKET_VERIFIED_SOURCE_REQUIRED');
  updates++;
 }
 if(!updates)throw Error('NFL_PACKET_NO_UPDATES');
 return updates;
}
export async function writeNflProjectionPacket(env,{packetText}){
 const now=Date.now();let approval;try{approval=JSON.parse(env.FBIS_NFL_PACKET_WRITE_APPROVAL||'null');}catch{throw Error('NFL_PACKET_APPROVAL_INVALID');}
 if(!approval||!/^\d{4}-\d{2}-\d{2}$/.test(approval.date||'')||!Number.isFinite(Date.parse(approval.expiresAt))||Date.parse(approval.expiresAt)<=now||Date.parse(approval.expiresAt)>now+600000||!hash(approval.packetSha256)||!hash(approval.sourcePublicationSha256)||!(approval.expectedEtag===null||typeof approval.expectedEtag==='string'&&approval.expectedEtag.length>0&&approval.expectedEtag.length<=128)||!(approval.expectedPreviousSha256===null||hash(approval.expectedPreviousSha256))||(approval.expectedEtag===null)!==(approval.expectedPreviousSha256===null))throw Error('NFL_PACKET_APPROVAL_INVALID');
 if(typeof packetText!=='string')throw Error('NFL_PACKET_INPUT_INVALID');
 const bytes=new TextEncoder().encode(packetText);if(bytes.length>MAX||bytes.length<2||await sha(bytes)!==approval.packetSha256)throw Error('NFL_PACKET_HASH_OR_SIZE_INVALID');
 const packet=JSON.parse(packetText);validateFourSportPacket(packet,{sport:'nfl',date:approval.date});
 if(!env.R2_ARCHIVE?.get||!env.R2_ARCHIVE?.put)throw Error('NFL_PACKET_BINDING_REQUIRED');
 const grant=await requireJobAdmission(env,JOB,NFL_PACKET_WRITE_ID),caps=CERTIFIED_EXECUTION_JOBS[JOB].units;
 if(grant.id!==NFL_PACKET_WRITE_ID||grant.job!==JOB||Object.keys(grant.maxUnits||{}).length!==Object.keys(caps).length||Object.entries(caps).some(([k,v])=>grant.maxUnits[k]!==v))throw Error('NFL_PACKET_ADMISSION_INVALID');
 const lease=createExecutionLease(grant);lease.spend({nflPacketWriteAttempts:1,coordinatorCalls:1,coordinatorStorageGets:2,coordinatorStoragePuts:2});
 if(Date.now()>=Date.parse(approval.expiresAt))lease.stop('NFL_PACKET_APPROVAL_EXPIRED');
 const store=executionR2(env.R2_ARCHIVE,lease),key=`private/nfl/projections/${approval.date}.json`,object=await store.get(key);lease.live();
 if((object?.etag??null)!==approval.expectedEtag){await object?.body?.cancel().catch(()=>{});lease.stop('NFL_PACKET_PREDECESSOR_CHANGED');}
 let previous=null;
 if(object){
  if(object.size>MAX){await object.body?.cancel().catch(()=>{});lease.stop('NFL_PACKET_PREDECESSOR_TOO_LARGE');}
  const oldBytes=new Uint8Array(await new Response(object.body).arrayBuffer());lease.live();
  if(oldBytes.length!==object.size||await sha(oldBytes)!==approval.expectedPreviousSha256)lease.stop('NFL_PACKET_PREDECESSOR_HASH_MISMATCH');
  previous=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(oldBytes));
 }
 const updates=validateNflPacketTransition(previous,packet,Date.now());lease.live();
 if(Date.now()>=Date.parse(approval.expiresAt))lease.stop('NFL_PACKET_APPROVAL_EXPIRED');
 const written=await store.put(key,bytes,{onlyIf:approval.expectedEtag===null?{etagDoesNotMatch:'*'}:{etagMatches:approval.expectedEtag},httpMetadata:{contentType:'application/json'},customMetadata:{packetSha256:approval.packetSha256,sourcePublicationSha256:approval.sourcePublicationSha256,generatedAt:packet.generatedAt,expiresAt:packet.expiresAt}});
 lease.live();if(!written)lease.stop('NFL_PACKET_CONDITIONAL_CONFLICT');
 return {key,etag:written.etag,packetSha256:approval.packetSha256,sourcePublicationSha256:approval.sourcePublicationSha256,updatedEvents:updates,bytes:bytes.length,budget:lease.snapshot(),canAuthorizeWager:false};
}

export const NFL_PACKET_VERIFY_ID='fbis-nfl-output-packet-verify-v1';
export async function verifyNflProjectionPacket(env){
 let approval;try{approval=JSON.parse(env.FBIS_NFL_PACKET_WRITE_APPROVAL||'null');}catch{throw Error('NFL_PACKET_APPROVAL_INVALID');}
 const now=Date.now();
 if(!approval||!/^\d{4}-\d{2}-\d{2}$/.test(approval.date||'')||new Date(approval.date+'T12:00:00Z').toISOString().slice(0,10)!==approval.date||!hash(approval.packetSha256)||!Number.isFinite(Date.parse(approval.expiresAt))||Date.parse(approval.expiresAt)<=now||Date.parse(approval.expiresAt)>now+600000)throw Error('NFL_PACKET_APPROVAL_INVALID');
 const grant=await requireJobAdmission(env,NFL_PACKET_VERIFY_JOB,NFL_PACKET_VERIFY_ID),caps=CERTIFIED_EXECUTION_JOBS[NFL_PACKET_VERIFY_JOB].units;
 if(grant.id!==NFL_PACKET_VERIFY_ID||grant.job!==NFL_PACKET_VERIFY_JOB||Object.keys(grant.maxUnits||{}).length!==Object.keys(caps).length||Object.entries(caps).some(([k,v])=>grant.maxUnits[k]!==v))throw Error('NFL_PACKET_ADMISSION_INVALID');
 const lease=createExecutionLease(grant);lease.spend({nflPacketVerifyAttempts:1,coordinatorCalls:1,coordinatorStorageGets:2,coordinatorStoragePuts:2});
 if(Date.now()>=Date.parse(approval.expiresAt))lease.stop('NFL_PACKET_APPROVAL_EXPIRED');
 const key=`private/nfl/projections/${approval.date}.json`,object=await executionR2(env.R2_ARCHIVE,lease).get(key);lease.live();
 if(!object?.body)lease.stop('NFL_PACKET_VERIFY_MISSING');
 const bytes=new Uint8Array(await new Response(object.body).arrayBuffer());lease.live();
 if(Date.now()>=Date.parse(approval.expiresAt))lease.stop('NFL_PACKET_APPROVAL_EXPIRED');
 if(bytes.length!==object.size||await sha(bytes)!==approval.packetSha256)lease.stop('NFL_PACKET_VERIFY_HASH_MISMATCH');
 return {key,verified:true,packetSha256:approval.packetSha256,bytes:bytes.length,budget:lease.snapshot(),canAuthorizeWager:false};
}

export const NFL_PACKET_INSPECT_ID='fbis-nfl-output-packet-inspect-v1';
export async function inspectNflProjectionPacket(env){
 const date=env.FBIS_NFL_PACKET_INSPECTION_DATE;
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('NFL_PACKET_INSPECTION_DATE_INVALID');
 if(!env.R2_ARCHIVE?.get)throw Error('NFL_PACKET_BINDING_REQUIRED');
 const grant=await requireJobAdmission(env,NFL_PACKET_INSPECT_JOB,NFL_PACKET_INSPECT_ID),caps=CERTIFIED_EXECUTION_JOBS[NFL_PACKET_INSPECT_JOB].units;
 if(grant.id!==NFL_PACKET_INSPECT_ID||grant.job!==NFL_PACKET_INSPECT_JOB||Object.keys(grant.maxUnits||{}).length!==Object.keys(caps).length||Object.entries(caps).some(([k,v])=>grant.maxUnits[k]!==v))throw Error('NFL_PACKET_ADMISSION_INVALID');
 const lease=createExecutionLease(grant);lease.spend({nflPacketInspectAttempts:1,coordinatorCalls:1,coordinatorStorageGets:2,coordinatorStoragePuts:2});
 const key=`private/nfl/projections/${date}.json`,object=await executionR2(env.R2_ARCHIVE,lease).get(key);lease.live();
 if(!object)return {key,found:false,etag:null,packetSha256:null,budget:lease.snapshot()};
 if(!object.body||typeof object.etag!=='string'||!object.etag)lease.stop('NFL_PACKET_INSPECTION_OBJECT_INVALID');
 const bytes=new Uint8Array(await new Response(object.body).arrayBuffer());lease.live();
 if(bytes.length!==object.size)lease.stop('NFL_PACKET_INSPECTION_LENGTH_MISMATCH');
 return {key,found:true,etag:object.etag,packetSha256:await sha(bytes),packetText:new TextDecoder('utf-8',{fatal:true}).decode(bytes),bytes:bytes.length,budget:lease.snapshot(),productionAuthority:false};
}
