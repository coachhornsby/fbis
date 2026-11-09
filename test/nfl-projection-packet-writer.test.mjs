import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {writeNflProjectionPacket,validateNflPacketTransition,NFL_PACKET_WRITE_ID} from '../services/nfl/writeProjectionPacket.mjs';
import {NFL_PACKET_WRITE_JOB as JOB,CERTIFIED_EXECUTION_JOBS,executionPolicyError} from '../services/account-budget/executionJobs.mjs';
import {NFL_VERIFIED_SOURCE_LABEL} from '../functions/lib/nflVerifiedRecoveryPacket.js';
import {boardDate} from '../functions/lib/publicBoardSnapshot.js';
const hash=text=>createHash('sha256').update(text).digest('hex');
function fixture(){const now=Date.now(),start=new Date(now+3600000).toISOString(),date=boardDate(start),generatedAt=new Date(now-1000).toISOString(),observedAt=new Date(now-2000).toISOString(),through=new Date(now-3000).toISOString();
 const event={eventId:'123',date,start,homeId:'nfl-1',awayId:'nfl-2',sourceCapturedAt:observedAt,sourceDataCutoffAt:through,sourceDataCutoffKind:'source-publication-upper-bound-not-game-completion',canAuthorizeWager:false,projection:{homeScore:24,awayScore:21,margin:3,total:45,modelId:'NFL-PRO-v1',modelVersion:'v1.2.1'},sourceLabel:NFL_VERIFIED_SOURCE_LABEL,nflVerifiedInput:{source:'nflverse',canAuthorizeWager:false,snapshotSha256:'a'.repeat(64),observedAt,dataThrough:through}};
 const packet={version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',sport:'nfl',date,generatedAt,expiresAt:new Date(now+600000).toISOString(),modelAuthority:'RESEARCH_ONLY',canAuthorizeWager:false,eventGeneratedAt:{123:generatedAt},events:[event]};
 const calls=[],approval={date,packetSha256:hash(JSON.stringify(packet)),sourcePublicationSha256:'b'.repeat(64),expectedEtag:null,expectedPreviousSha256:null,expiresAt:new Date(now+300000).toISOString()};
 const env={FBIS_NFL_PACKET_WRITE_APPROVAL:JSON.stringify(approval),CLOUDFLARE_ACCOUNT_ID:'offline',FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async()=>{calls.push('reserve');return {allowed:true,id:NFL_PACKET_WRITE_ID,job:JOB,maxUnits:{...CERTIFIED_EXECUTION_JOBS[JOB].units},expiresAtMs:Date.now()+60000};}})},R2_ARCHIVE:{get:async key=>{calls.push(['get',key]);return null;},put:async(key,bytes,options)=>{calls.push(['put',key,options]);return {etag:'new'};}}};
 return {packet,approval,env,calls};}
const input=f=>({packetText:JSON.stringify(f.packet)});
const approve=f=>{f.approval.packetSha256=hash(JSON.stringify(f.packet));f.env.FBIS_NFL_PACKET_WRITE_APPROVAL=JSON.stringify(f.approval);};
test('approved output writes only exact NFL date key under separate one-shot budget',async()=>{const f=fixture(),r=await writeNflProjectionPacket(f.env,input(f));assert.equal(r.updatedEvents,1);assert.equal(r.budget.used.r2Reads,1);assert.equal(r.budget.used.r2Writes,1);assert.equal(r.canAuthorizeWager,false);assert.equal(f.calls[1][1],`private/nfl/projections/${f.packet.date}.json`);assert.deepEqual(f.calls[2][2].onlyIf,{etagDoesNotMatch:'*'});});
test('missing/expired/hash-mismatched approval makes zero calls',async()=>{for(const value of ['null','bad',JSON.stringify({...fixture().approval,expiresAt:'2000-01-01T00:00:00Z'})]){const f=fixture();f.env.FBIS_NFL_PACKET_WRITE_APPROVAL=value;await assert.rejects(()=>writeNflProjectionPacket(f.env,input(f)));assert.equal(f.calls.length,0);}const f=fixture();f.packet.events[0].sourceLabel='changed';await assert.rejects(()=>writeNflProjectionPacket(f.env,input(f)),/HASH_OR_SIZE/);assert.equal(f.calls.length,0);});
test('frozen event, generation stamp, removal and expiry extension are rejected',()=>{
 const f=fixture(),old=structuredClone(f.packet),now=Date.now();old.events[0].start=new Date(now-1000).toISOString();old.generatedAt=new Date(now-10000).toISOString();old.eventGeneratedAt['123']=old.generatedAt;old.events[0].sourceCapturedAt=new Date(now-20000).toISOString();
 const p=structuredClone(old);p.generatedAt=new Date(now-500).toISOString();
 assert.throws(()=>validateNflPacketTransition(old,p,now),/NO_UPDATES/);
 const mutate=structuredClone(p);mutate.events[0].projection.homeScore=25;mutate.events[0].projection.margin=4;mutate.events[0].projection.total=46;assert.throws(()=>validateNflPacketTransition(old,mutate,now),/FROZEN_EVENT/);
 const restamp=structuredClone(p);restamp.eventGeneratedAt['123']=p.generatedAt;assert.throws(()=>validateNflPacketTransition(old,restamp,now));
 const remove=structuredClone(p);remove.events=[];assert.throws(()=>validateNflPacketTransition(old,remove,now),/EVENT_REMOVAL/);
 const expiry=structuredClone(p);expiry.expiresAt=new Date(Date.parse(old.expiresAt)+1000).toISOString();assert.throws(()=>validateNflPacketTransition(old,expiry,now),/EXPIRY/);
});
test('known predecessor must match hash and etag; conditional conflict never retries',async()=>{const f=fixture();f.env.R2_ARCHIVE.get=async()=>({size:2,etag:'unknown',body:new Response('{}').body});await assert.rejects(()=>writeNflProjectionPacket(f.env,input(f)),/PREDECESSOR_CHANGED/);assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='put').length,0);const g=fixture();let puts=0;g.env.R2_ARCHIVE.put=async()=>{puts++;return null;};await assert.rejects(()=>writeNflProjectionPacket(g.env,input(g)),/CONDITIONAL_CONFLICT/);assert.equal(puts,1);});
test('future ESPN fallback cannot be presented as verified NFL advanced output',()=>{const f=fixture();f.packet.events[0].projection.modelId='NFL-TEAM-FORM-v0';assert.throws(()=>validateNflPacketTransition(null,f.packet,Date.now()),/VERIFIED_SOURCE/);});
test('new packet write policy requires independent exact caps and overhead',()=>{const units=CERTIFIED_EXECUTION_JOBS[JOB].units,p={jobs:{[JOB]:{maxUnits:{...units},coordinatorOverheadMicroUsd:1,preAdmissionAttemptCeiling:1,runtimeCpuLimitMs:100}},unitCeilings:{nflPacketWriteAttempts:1}};assert.equal(executionPolicyError(p,JOB),null);p.jobs[JOB].maxUnits.r2Writes=2;assert.equal(executionPolicyError(p,JOB),'INSPECTION_EXACT_UNITS_REQUIRED');});
test('mixed packet preserves frozen event bytes and stamps while conditionally updating future event',async()=>{
 const f=fixture(),old=structuredClone(f.packet),now=Date.now();old.generatedAt=new Date(now-20000).toISOString();old.events[0].eventId='456';old.events[0].start=new Date(now-1000).toISOString();old.events[0].sourceCapturedAt=new Date(now-30000).toISOString();old.eventGeneratedAt={456:old.generatedAt};
 f.packet.events.unshift(structuredClone(old.events[0]));f.packet.eventGeneratedAt['456']=old.generatedAt;
 const previousText=JSON.stringify(old);f.approval.expectedEtag='prior';f.approval.expectedPreviousSha256=hash(previousText);approve(f);
 f.env.R2_ARCHIVE.get=async()=>({size:new TextEncoder().encode(previousText).length,etag:'prior',body:new Response(previousText).body});
 const result=await writeNflProjectionPacket(f.env,input(f));assert.equal(result.updatedEvents,1);assert.deepEqual(f.calls.at(-1)[2].onlyIf,{etagMatches:'prior'});assert.equal(JSON.stringify(f.packet.events[0]),JSON.stringify(old.events[0]));assert.equal(f.packet.eventGeneratedAt['456'],old.generatedAt);assert.equal(f.packet.expiresAt,old.expiresAt);
});
test('post-write verification uses separate job and compares approved exact hash',async()=>{
 const {verifyNflProjectionPacket,NFL_PACKET_VERIFY_ID}=await import('../services/nfl/writeProjectionPacket.mjs');const {NFL_PACKET_VERIFY_JOB}=await import('../services/account-budget/executionJobs.mjs');const f=fixture(),text=JSON.stringify(f.packet);
 f.env.FBIS_ACCOUNT_BUDGET={getByName:()=>({reserve:async request=>{assert.equal(request.job,NFL_PACKET_VERIFY_JOB);return {allowed:true,id:NFL_PACKET_VERIFY_ID,job:NFL_PACKET_VERIFY_JOB,maxUnits:{...CERTIFIED_EXECUTION_JOBS[NFL_PACKET_VERIFY_JOB].units},expiresAtMs:Date.now()+60000};}})};
 f.env.R2_ARCHIVE.get=async()=>({size:new TextEncoder().encode(text).length,body:new Response(text).body});assert.equal((await verifyNflProjectionPacket(f.env)).verified,true);
 f.env.R2_ARCHIVE.get=async()=>({size:2,body:new Response('{}').body});await assert.rejects(()=>verifyNflProjectionPacket(f.env),/VERIFY_HASH_MISMATCH/);
});
test('packet that starts after preparation but before write cannot be inserted',async()=>{const f=fixture();f.packet.events[0].start=new Date(Date.now()-1).toISOString();approve(f);await assert.rejects(()=>writeNflProjectionPacket(f.env,input(f)),/UPDATE_NOT_FUTURE/);assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='put').length,0);});
test('approval expiring during predecessor read blocks write despite live execution lease',async()=>{const f=fixture(),original=Date.now,now=Date.now();f.approval.expiresAt=new Date(now+3000).toISOString();approve(f);f.env.R2_ARCHIVE.get=async()=>{Date.now=()=>now+4000;return null;};try{await assert.rejects(()=>writeNflProjectionPacket(f.env,input(f)),/APPROVAL_EXPIRED/);assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='put').length,0);}finally{Date.now=original;}});
test('mixed numeric/string duplicate event IDs cannot evade frozen-event comparison',()=>{const f=fixture();f.packet.events.push({...structuredClone(f.packet.events[0]),eventId:123});assert.throws(()=>validateNflPacketTransition(null,f.packet,Date.now()),/DUPLICATE_OR_EXCESS/);});
test('predecessor inspection is separately admitted, date pinned, bounded and hash bound',async()=>{
 const {inspectNflProjectionPacket,NFL_PACKET_INSPECT_ID}=await import('../services/nfl/writeProjectionPacket.mjs');const {NFL_PACKET_INSPECT_JOB}=await import('../services/account-budget/executionJobs.mjs');const f=fixture(),text=JSON.stringify(f.packet);
 f.env.FBIS_NFL_PACKET_INSPECTION_DATE=f.packet.date;
 f.env.FBIS_ACCOUNT_BUDGET={getByName:()=>({reserve:async request=>{assert.equal(request.job,NFL_PACKET_INSPECT_JOB);return {allowed:true,id:NFL_PACKET_INSPECT_ID,job:NFL_PACKET_INSPECT_JOB,maxUnits:{...CERTIFIED_EXECUTION_JOBS[NFL_PACKET_INSPECT_JOB].units},expiresAtMs:Date.now()+60000};}})};
 assert.equal((await inspectNflProjectionPacket(f.env)).found,false);
 f.env.R2_ARCHIVE.get=async key=>{assert.equal(key,`private/nfl/projections/${f.packet.date}.json`);return {size:new TextEncoder().encode(text).length,etag:'prior',body:new Response(text).body};};
 const result=await inspectNflProjectionPacket(f.env);assert.equal(result.packetText,text);assert.equal(result.packetSha256,hash(text));assert.equal(result.etag,'prior');
 f.env.FBIS_NFL_PACKET_INSPECTION_DATE='../cfb';await assert.rejects(()=>inspectNflProjectionPacket(f.env),/DATE_INVALID/);
});
test('scores and held player rows publish atomically; started player estimates cannot change',async()=>{
 const f=fixture(),research={version:1,state:'HOLD_VALIDATION',canAuthorizeWager:false,canQualify:false,rows:[{playerId:'qb-1',playerName:'Test Quarterback',teamId:'nfl-1',position:'QB',market:'passing_yards',projection:250,gate:'HOLD'}]};
 f.packet.events[0].nflPlayerResearch=research;approve(f);let stored;
 f.env.R2_ARCHIVE.put=async(key,bytes)=>{stored=JSON.parse(new TextDecoder().decode(bytes));return {etag:'written'};};
 await writeNflProjectionPacket(f.env,input(f));assert.deepEqual(stored.events[0].nflPlayerResearch,research);
 const old=structuredClone(f.packet),now=Date.now();old.generatedAt=new Date(now-20000).toISOString();old.eventGeneratedAt['123']=old.generatedAt;old.events[0].start=new Date(now-1000).toISOString();old.events[0].sourceCapturedAt=new Date(now-30000).toISOString();
 const next=structuredClone(old);next.generatedAt=new Date(now-500).toISOString();next.events[0].nflPlayerResearch.rows[0].projection=999;
 assert.throws(()=>validateNflPacketTransition(old,next,now),/FROZEN_EVENT_CHANGED/);
 const unauthorized=fixture();unauthorized.packet.events[0].nflPlayerResearch={...research,canAuthorizeWager:true};assert.throws(()=>validateNflPacketTransition(null,unauthorized.packet,Date.now()),/INVALID_NFL_PLAYER_RESEARCH/);
});
