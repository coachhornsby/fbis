import {readPinnoddsAccountUsage} from './pinnodds-account-usage.mjs';
export const PINNODDS_CAPTURE_REQUESTS=15;
// PinnOdds public Trial REST tier is $0; its requests consume quota, not dollars.
// The paid-Actor $0.70 ceiling applies to Apify, NOT to PinnOdds.
export const PINNODDS_TRIAL_REST_COST_USD=0;
export const PINNODDS_TRIAL_DOCUMENTED_LIMITS=Object.freeze({perDay:100,perMinute:20});
/**
 * Only individually scoped events with previously verified FBIS projections
 * may be acquired. Legacy whole-sport boards/drop buffers stay paused.
 * The caller must prove the event identity and model forecast before admission.
 */
export function requireProjectedFreeScope({canonicalEventId=null,providerEventId=null,kind='board'}={}){
 if(!canonicalEventId||!/^\\d+$/.test(String(providerEventId||''))||!['prematch_event','live_event'].includes(kind))
   throw Error('PINNODDS_PROJECTION_ONLY_EVENT_SCOPE_REQUIRED');
 return {allowed:true,canonicalEventId,providerEventId:String(providerEventId),costUsd:PINNODDS_TRIAL_REST_COST_USD};
}
export function verifyPinnoddsFreeTrial(usage){
 const planId=String(usage?.plan?.id||'').toLowerCase();
 if(planId!=='trial'&&planId!=='free')throw Error('PINNODDS_FREE_PLAN_NOT_VERIFIED');
 const limits=usage?.plan?.limits||{};
 if(!Number.isFinite(Number(limits.perDay))||Number(limits.perDay)<=0||
    !Number.isFinite(Number(limits.perMin))||Number(limits.perMin)<=0)
   throw Error('PINNODDS_FREE_QUOTA_NOT_VERIFIED');
 return {planId,limits,perRequestUsd:PINNODDS_TRIAL_REST_COST_USD};
}

const root='market-sources/pinnodds';
const valid=id=>/^[a-z0-9-]{1,140}$/i.test(id||'');
const jsonOptions={httpMetadata:{contentType:'application/json'}};
async function hash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function reservePinnoddsRun(env,{runId,scope='full',now=new Date(),fetchImpl=fetch}={}){
 if(!['full','drops'].includes(scope))throw Error('INVALID_RESERVATION_SCOPE');
 // Legacy full-sport/drop-buffer requests remain paused for projection-only scope, NOT for price.
 requireProjectedFreeScope({kind:scope});
 const requests=scope==='drops'?2:PINNODDS_CAPTURE_REQUESTS;
 if(!valid(runId)||!env.R2_ARCHIVE?.get||!env.R2_ARCHIVE?.put)throw Error('INVALID_DURABLE_RESERVATION');
 const runKey=`${root}/runs/${runId}.json`,existing=await env.R2_ARCHIVE.get(runKey);if(existing)return await existing.json();
 const account=await readPinnoddsAccountUsage({apiKey:env.PINNODDS_API_KEY,fetchImpl});
 const usage=account.usage,limits=usage?.plan?.limits,used=Number(usage?.usage_today),daily=Number(limits?.perDay),minute=Number(limits?.perMin);
 if(usage?.status!=='active'||!Number.isFinite(used)||used<0||!Number.isFinite(daily)||daily<=0||!Number.isFinite(minute)||minute<requests)throw Error('UNVERIFIED_ACCOUNT_ENTITLEMENT');
 if(used+requests+10>daily)throw Error('INSUFFICIENT_EXISTING_DAILY_QUOTA');
 const day=now.toISOString().slice(0,10),budgetKey=`${root}/budgets/${day}.json`;
 for(let retry=0;retry<5;retry++){
  const object=await env.R2_ARCHIVE.get(budgetKey),budget=object?await object.json():{reservations:[]};
  const reservations=budget.reservations||[];
  if(!reservations.some(r=>r.runId===runId)){
   if(reservations.reduce((sum,r)=>sum+r.requests,0)+requests>Math.min(70,daily-10))throw Error('FBIS_DAILY_CAPTURE_BUDGET_EXHAUSTED');
   if(reservations.filter(r=>now.getTime()-Date.parse(r.at)<60000).reduce((sum,r)=>sum+r.requests,0)+requests>minute)throw Error('FBIS_MINUTE_BUDGET_EXHAUSTED');
   reservations.push({runId,requests,at:now.toISOString()});
   const written=await env.R2_ARCHIVE.put(budgetKey,JSON.stringify({day,reservations}),{...jsonOptions,onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:'*'}});
   if(!written)continue;
  }
  const reservation={ok:true,runId,reservedAt:now.toISOString(),day,requestsReserved:requests,scope,quotaProof:account,
   readOnly:true,canAuthorizeWager:false};
  await env.R2_ARCHIVE.put(runKey,JSON.stringify(reservation),jsonOptions);return reservation;
 }
 throw Error('RESERVATION_CONTENTION');
}
export async function capturePinnoddsSnapshot(env,{runId,kind,sportId=null,feed=null,fetchImpl=fetch,now=new Date()}={}){
 requireProjectedFreeScope({kind});
 if(!valid(runId)||!['board','drops','health'].includes(kind)||kind!=='health'&&!['live','prematch'].includes(feed)||kind==='board'&&![1,2,3,4,5,6].includes(sportId))throw Error('INVALID_CAPTURE_SCOPE');
 const runObject=await env.R2_ARCHIVE.get(`${root}/runs/${runId}.json`);if(!runObject)throw Error('QUOTA_RESERVATION_REQUIRED');
 const reservation=await runObject.json();if(reservation.scope==='drops'&&kind!=='drops')throw Error('RESERVATION_SCOPE_MISMATCH');if(reservation.day!==now.toISOString().slice(0,10))throw Error('RESERVATION_EXPIRED');
 const snapshotId=`${runId}-${kind}-${sportId||'all'}-${feed||'all'}`,receiptKey=`${root}/receipts/${snapshotId}.json`;
 const prior=await env.R2_ARCHIVE.get(receiptKey);if(prior){const receipt=await prior.json();if(receipt.ok===true)return receipt;throw Error('PROVIDER_ATTEMPT_ALREADY_RESERVED_NO_AUTOMATIC_RECHARGE');}
 const claim=await env.R2_ARCHIVE.put(receiptKey,JSON.stringify({ok:false,snapshotId,state:'ATTEMPT_RESERVED',at:now.toISOString()}),{...jsonOptions,onlyIf:{etagDoesNotMatch:'*'}});
 if(!claim)throw Error('CAPTURE_ALREADY_RESERVED');
 const url=new URL(kind==='board'?'/kit/v1/markets':kind==='drops'?'/api/drops':'/health','https://pinnodds.com');
 // Flat soccer prematch specials can expand beyond the Worker string limit. The
 // provider's nested format keeps every special attached to its parent event;
 // the ingest normalizer expands them after immutable raw archival.
 if(kind==='board'){url.searchParams.set('sport_id',sportId);url.searchParams.set('event_type',feed);url.searchParams.set('include_specials',sportId===1&&feed==='prematch'?'nested':'1');}
 if(kind==='drops'){url.searchParams.set('mode',feed);url.searchParams.set('min_drop_pct','0');url.searchParams.set('max_age_sec','10800');url.searchParams.set('limit','10000');}
 const response=await fetchImpl(url,{headers:{'x-api-key':env.PINNODDS_API_KEY,accept:'application/json'},signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw Error('PINNODDS_PROVIDER_HTTP_'+response.status);
 const raw=await response.text(),rawHash=await hash(raw),rawKey=`${root}/raw/${rawHash}.json`;
 await env.R2_ARCHIVE.put(rawKey,raw,jsonOptions);
 const body=JSON.parse(raw);if(kind==='board'&&!Array.isArray(body.events))throw Error('PINNODDS_EVENTS_CONTRACT_CHANGED');
 const receipt={ok:true,snapshotId,runId,kind,sportId,feed,captureStartedAt:now.toISOString(),collectedAt:new Date().toISOString(),sourceUrl:url.toString(),rawHash,rawKey,
  providerStatus:response.headers.get('x-data-status')||null,providerDataAge:response.headers.get('x-data-age')||null,
  providerCursor:body.last??null,dropBufferHours:kind==='drops'?3:null,dropResponseLimit:kind==='drops'?10000:null,dropBufferComplete:kind==='drops'?(Array.isArray(body.drops)&&body.drops.length<10000&&(body.total==null||Number(body.total)<=body.drops.length)):null,providerEventCount:body.events?.length??null,readOnly:true,canAuthorizeWager:false};
 await env.R2_ARCHIVE.put(receiptKey,JSON.stringify(receipt),jsonOptions);return receipt;
}
