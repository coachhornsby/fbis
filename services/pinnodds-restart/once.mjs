// Offline-prepared recovery primitive. Not routed, scheduled or certified.
// Admission policy and authenticated entrypoint must be approved independently.
import {requireJobAdmission} from '../account-budget/admission.mjs';
import {createExecutionLease,executionR2,executionFetch} from '../account-budget/execution.mjs';
import {readPinnoddsAccountUsage} from '../../workers/pinnodds-account-usage.mjs';
import {verifyPinnoddsFreeTrial} from '../../workers/pinnodds-governed-capture.mjs';
export const JOB='services/pinnodds-restart/once.mjs';
export const ATTEMPT='pinnodds-football-prematch-restart-v1';
export const CAPS=Object.freeze({requests:4,responseBytes:2293760,r2Reads:0,r2Writes:3,r2Bytes:2162688,r2Lists:0,d1Queries:0,reads:0,writes:0});
export const SOURCE='https://pinnodds.com/kit/v1/markets?sport_id=5&event_type=prematch&include_specials=0';
export const ROOT='market-sources/pinnodds/restart-v1';
export const sha256=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),n=>n.toString(16).padStart(2,'0')).join('');
export async function boundedAccountFetch(lease,fetchImpl,input,init){
 if(input!=='https://mcp.pinnodds.com/mcp'||init.method!=='POST')lease.stop('ACCOUNT_DESTINATION_REJECTED');
 lease.spend({requests:1});
 const r=await fetchImpl(input,{...init,redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(20000,lease.expiresAtMs-Date.now())))});
 lease.live();if(!r.ok){await r.body?.cancel();throw Error('PINNODDS_ACCOUNT_HTTP_'+r.status);}
 const reader=r.body?.getReader(),parts=[];let size=0;
 if(reader)try{while(true){lease.live();const p=await reader.read();lease.live();if(p.done)break;size+=p.value.byteLength;lease.spend({responseBytes:p.value.byteLength});if(size>65536)lease.stop('ACCOUNT_RESPONSE_LIMIT');parts.push(p.value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const body=new Uint8Array(size);let at=0;for(const p of parts){body.set(p,at);at+=p.length;}
 return new Response(size?body:null,{status:r.status,headers:r.headers});
}
export async function captureOnce(env,{fetchImpl=fetch,admit=requireJobAdmission}={}){
 if(env?.PINNODDS_RESTART_ONCE_ENABLED!=='true')throw Error('PINNODDS_RESTART_DISABLED');
 if(!env.R2_ARCHIVE?.put||!env.PINNODDS_API_KEY)throw Error('PINNODDS_RESTART_BINDING_REQUIRED');
 const grant=await admit(env,JOB,ATTEMPT);
 if(grant.id!==ATTEMPT||grant.job!==JOB||Object.keys(grant.maxUnits||{}).length!==Object.keys(CAPS).length||Object.entries(CAPS).some(([k,v])=>grant.maxUnits[k]!==v))throw Error('PINNODDS_RESTART_ADMISSION_MISMATCH');
 const lease=createExecutionLease(grant),archive=executionR2(env.R2_ARCHIVE,lease);
 const attemptedAt=new Date().toISOString();
 // Survives account failures and uncertain provider responses. Never retry by
 // changing the attempt key; an operator must reconcile and approve a new job.
 const claim=await archive.put(ROOT+'/attempt.json',JSON.stringify({attempt:ATTEMPT,attemptedAt}),{onlyIf:{etagDoesNotMatch:'*'}});
 if(!claim)throw Error('PINNODDS_RESTART_ALREADY_ATTEMPTED');
 const account=await readPinnoddsAccountUsage({apiKey:env.PINNODDS_API_KEY,fetchImpl:(...args)=>boundedAccountFetch(lease,fetchImpl,...args)});
 verifyPinnoddsFreeTrial(account.usage);
 const used=account.usage?.usage_today,limit=account.usage?.plan?.limits?.perDay;
 if(account.usage?.status!=='active'||!Number.isSafeInteger(used)||used<0||!Number.isSafeInteger(limit)||used+11>limit)throw Error('PINNODDS_RESTART_QUOTA_NOT_VERIFIED');
 const pull=executionFetch(lease,fetchImpl,{origin:'https://pinnodds.com',path:'/kit/v1/markets'});
 const captureStartedAt=new Date().toISOString();
 const response=await pull(SOURCE,{headers:{'x-api-key':env.PINNODDS_API_KEY,accept:'application/json'}});
 if(!response.ok){await response.body?.cancel();throw Error('PINNODDS_PROVIDER_HTTP_'+response.status);}
 const raw=await response.text();lease.live();
 const collectedAt=new Date().toISOString();
 if(new TextEncoder().encode(raw).length>2097152)throw Error('PINNODDS_RESTART_RAW_LIMIT');
 const body=JSON.parse(raw);if(!Array.isArray(body.events)||body.events.length>2000)throw Error('PINNODDS_RESTART_EVENTS_LIMIT');
 const rawHash=await sha256(raw),rawKey=ROOT+'/raw-'+rawHash+'.json';
 await archive.put(rawKey,raw,{onlyIf:{etagDoesNotMatch:'*'}});
 const receipt={ok:true,snapshotId:ATTEMPT,sportId:5,feed:'prematch',collectedAt,captureStartedAt,rawHash,rawKey,sourceUrl:SOURCE,providerEventCount:body.events.length,providerStatus:response.headers.get('x-data-status'),providerQuoteClockVerified:false,sourceObservedAt:null,providerRequests:1,providerCostUsd:0,canAuthorizeWager:false};
 if(!await archive.put(ROOT+'/receipt.json',JSON.stringify(receipt),{onlyIf:{etagDoesNotMatch:'*'}}))throw Error('PINNODDS_RESTART_RECEIPT_CONFLICT');
 return {receipt,budget:lease.snapshot()};
}

export const ACCOUNT_JOB=JOB+':account';
export const ACCOUNT_ATTEMPT='pinnodds-account-check-v1';
export const ACCOUNT_CAPS=Object.freeze({...CAPS,requests:3,responseBytes:196608,r2Writes:2,r2Bytes:4096});
export async function checkAccountOnce(env,{fetchImpl=fetch,admit=requireJobAdmission}={}){
 if(env?.PINNODDS_ACCOUNT_CHECK_ENABLED!=='true')throw Error('PINNODDS_ACCOUNT_CHECK_DISABLED');
 if(!env.R2_ARCHIVE?.put||!env.PINNODDS_API_KEY)throw Error('PINNODDS_RESTART_BINDING_REQUIRED');
 const grant=await admit(env,ACCOUNT_JOB,ACCOUNT_ATTEMPT);
 if(grant.id!==ACCOUNT_ATTEMPT||grant.job!==ACCOUNT_JOB||Object.keys(grant.maxUnits||{}).length!==Object.keys(ACCOUNT_CAPS).length||Object.entries(ACCOUNT_CAPS).some(([k,v])=>grant.maxUnits[k]!==v))throw Error('PINNODDS_RESTART_ADMISSION_MISMATCH');
 const lease=createExecutionLease(grant),archive=executionR2(env.R2_ARCHIVE,lease);
 if(!await archive.put(ROOT+'/account-attempt.json',JSON.stringify({attempt:ACCOUNT_ATTEMPT,at:new Date().toISOString()}),{onlyIf:{etagDoesNotMatch:'*'}}))throw Error('PINNODDS_ACCOUNT_ALREADY_ATTEMPTED');
 const account=await readPinnoddsAccountUsage({apiKey:env.PINNODDS_API_KEY,fetchImpl:(...args)=>boundedAccountFetch(lease,fetchImpl,...args)});
 const {planId}=verifyPinnoddsFreeTrial(account.usage);
 const u=account.usage,remaining=Number.isSafeInteger(u.usage_today)&&Number.isSafeInteger(u.plan.limits.perDay)?u.plan.limits.perDay-u.usage_today:null;
 const result={ok:true,capturedAt:account.capturedAt,planId,active:u.status==='active',remainingDailyRequests:remaining,chargeableOddsRequests:0,canAuthorizeWager:false};
 if(!await archive.put(ROOT+'/account-result.json',JSON.stringify(result),{onlyIf:{etagDoesNotMatch:'*'}}))throw Error('PINNODDS_ACCOUNT_RECEIPT_CONFLICT');
 return {result,budget:lease.snapshot()};
}
