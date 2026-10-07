import { sha256Hex } from './sha256Hex.js';

// This is the only FBIS implementation allowed to POST a paid Actor launch.
// A transport/persistence failure after START is ambiguous, never permission to relaunch.
export function canonicalScope(value) {
 if(Array.isArray(value)) return [...new Set(value.map(canonicalScope).map(JSON.stringify))].sort().map(JSON.parse);
 if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalScope(value[k])]));
 return value;
}
export function billingWindow(now=new Date(), day=12) {
 const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),day));
 if(start>now)start.setUTCMonth(start.getUTCMonth()-1);
 const end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
 return {start:start.toISOString(),end:end.toISOString()};
}
const terminal=new Set(['SUCCEEDED','SUCCEEDED_WITH_WARNINGS','FAILED','ABORTED','TIMED-OUT']);
const uncertain=new Set(['CLAIMED','UNKNOWN_START','RUNNING']);
function fail(reason,status=409){return new Response(JSON.stringify({error:{type:reason,message:reason}}),{status,headers:{'content-type':'application/json'}});}
function tokenOf(env){return String(env.APIFY_TOKEN||env.APIFY_API_TOKEN||'').trim();}
async function demand(DB,{source,component,sport,hash,outcome,id=null,reason=null,now}){
 await DB.prepare('INSERT INTO external_acquisition_requests VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),source,component,sport,hash,outcome,id,reason,now).run();
 if(id)await DB.prepare('INSERT OR IGNORE INTO external_acquisition_consumers(acquisition_id,component,sport,requested_at) VALUES(?,?,?,?)').bind(id,component,sport,now).run();
}
export async function startPaidAcquisition(env,{source,input,component,sport='shared',origin=null,fetchImpl=fetch,now=new Date(),waitSecs=0}={}) {
 const DB=env.DB, token=tokenOf(env);
 if(!DB||!env.ARCHIVE||!token)return fail('ACQUISITION_DURABILITY_REQUIRED',503);
 const scope=JSON.stringify(canonicalScope(input)),hash=await sha256Hex(scope),at=now.toISOString();
 let policy,account;
 try {policy=await DB.prepare('SELECT * FROM external_acquisition_policy WHERE source=?').bind(source).first();account=await DB.prepare("SELECT * FROM external_acquisition_account WHERE id='apify'").first();}
 catch{return fail('ACQUISITION_POLICY_UNAVAILABLE',503);}
 if(!policy||!component)return fail('ACQUISITION_POLICY_REQUIRED',503);
 const since=new Date(+now-policy.freshness_seconds*1000).toISOString();
 const reusable=await DB.prepare("SELECT * FROM external_acquisitions WHERE source=? AND scope_hash=? AND ((state IN ('CLAIMED','UNKNOWN_START','RUNNING')) OR (created_at>=? AND state='CAPTURED')) ORDER BY created_at DESC LIMIT 1").bind(source,hash,since).first();
 if(reusable){
   await demand(DB,{source,component,sport,hash,outcome:'REUSED',id:reusable.id,now:at});
   if(!reusable.provider_run_id)return fail('ACQUISITION_START_UNCERTAIN');
   if(reusable.state==='CAPTURED'&&reusable.raw_key){
     return new Response(JSON.stringify({data:{id:reusable.provider_run_id,defaultDatasetId:reusable.dataset_id,status:reusable.provider_status||'SUCCEEDED',startedAt:reusable.created_at,finishedAt:reusable.captured_at},acquisitionId:reusable.id,rawKey:reusable.raw_key,reused:true}));
   }
   const existing=await fetchImpl(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(reusable.provider_run_id)}`,{headers:{authorization:`Bearer ${token}`}});
   if(!existing.ok)return fail('EXISTING_ACQUISITION_READ_BLOCKED',503);
   const payload=await existing.json();
   if(payload.data?.id!==reusable.provider_run_id)return fail('EXISTING_ACQUISITION_ID_MISMATCH',503);
   await recordAcquisitionRun(env,payload.data);
   return new Response(JSON.stringify({...payload,acquisitionId:reusable.id,reused:true}));
 }
 const deny=async reason=>{await demand(DB,{source,component,sport,hash,outcome:'BLOCKED',reason,now:at});return fail(reason);};
 if(policy.state!=='ACTIVE'||account?.state!=='ACTIVE')return deny(account?.reason||policy.reason||'ACQUISITION_BLOCKED');
 // Provider account usage covers ALL Actors, storage, transfer, proxy and other account services.
 // Never infer account headroom from sports-only estimated ledgers.
 const age=+now-Date.parse(account.usage_observed_at||'');
 if(!Number.isFinite(age)||age<0||age>3600000||!(account.period_start<=at&&at<account.period_end)||account.provider_usage_usd==null)return deny('ACCOUNT_USAGE_RECONCILIATION_STALE');
 const id='acq_'+crypto.randomUUID(),hour=new Date(+now-3600000).toISOString(),day=new Date(+now-86400000).toISOString();
 // D1 serializes this ONE conditional insert: claim, budget reserve and rate limits are atomic.
 const claim=await DB.prepare(`INSERT INTO external_acquisitions(id,source,actor,scope_hash,scope_json,origin,state,reserved_charge_usd,created_at,updated_at)
 SELECT ?,?,?,?,?,?,'CLAIMED',?,?,?
 WHERE NOT EXISTS(SELECT 1 FROM external_acquisitions WHERE source=? AND scope_hash=? AND (state IN ('CLAIMED','UNKNOWN_START','RUNNING') OR created_at>=?))
 AND (SELECT COUNT(*) FROM external_acquisitions WHERE source=? AND created_at>=?) < ?
 AND (SELECT COUNT(*) FROM external_acquisitions WHERE source=? AND created_at>=?) < ?
 AND COALESCE((SELECT SUM(reserved_charge_usd) FROM external_acquisitions WHERE source=? AND created_at>=?),0)+? <= ?
 AND ?+COALESCE((SELECT SUM(reserved_charge_usd) FROM external_acquisitions WHERE created_at>=? OR state IN ('CLAIMED','UNKNOWN_START','RUNNING')),0)+? <= ?`)
 .bind(id,source,policy.actor,hash,scope,origin||component,policy.per_run_cap_usd,at,at,source,hash,since,source,hour,policy.hourly_run_limit,source,day,policy.daily_run_limit,source,day,policy.per_run_cap_usd,policy.daily_cap_usd,account.provider_usage_usd,account.usage_observed_at,policy.per_run_cap_usd,Math.min(account.target_usd,account.hard_cap_usd)).run();
 if(Number(claim.meta?.changes)!==1)return deny('ACQUISITION_BUDGET_RATE_OR_SCOPE_CONFLICT');
 await demand(DB,{source,component,sport,hash,outcome:'CLAIMED',id,now:at});
 let response;
 try{
   response=await fetchImpl(`https://api.apify.com/v2/acts/${encodeURIComponent(policy.actor)}/runs?waitForFinish=${Math.min(60,Math.max(0,waitSecs))}&maxTotalChargeUsd=${policy.per_run_cap_usd}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:scope});
   const payload=await response.json(),run=payload.data;
   if(!response.ok||!run?.id){await DB.prepare("UPDATE external_acquisitions SET state='UNKNOWN_START',error=?,updated_at=? WHERE id=?").bind(`start-http-${response.status}`,at,id).run();return fail('ACQUISITION_START_UNCERTAIN',502);}
   await DB.prepare("UPDATE external_acquisitions SET state='RUNNING',provider_run_id=?,dataset_id=?,provider_status=?,updated_at=? WHERE id=?").bind(run.id,run.defaultDatasetId||null,run.status||'READY',at,id).run();
   return new Response(JSON.stringify({...payload,acquisitionId:id}),{status:response.status,headers:{'content-type':'application/json'}});
 }catch{
   await DB.prepare("UPDATE external_acquisitions SET state='UNKNOWN_START',error='transport-or-persistence-uncertain',updated_at=? WHERE id=?").bind(at,id).run();
   return fail('ACQUISITION_START_UNCERTAIN',502);
 }
}
export async function recordAcquisitionRun(env,run){
 if(!env.DB||!run?.id)return;
 const cost=typeof run.usageTotalUsd==='number'&&Number.isFinite(run.usageTotalUsd)?run.usageTotalUsd:null;
 await env.DB.prepare(`UPDATE external_acquisitions SET dataset_id=COALESCE(?,dataset_id),provider_status=?,provider_cost_usd=COALESCE(?,provider_cost_usd),cost_provenance=CASE WHEN ? IS NOT NULL THEN 'PROVIDER_REPORTED_RUN_USAGE' ELSE cost_provenance END,state=CASE WHEN ? IN ('FAILED','ABORTED','TIMED-OUT') THEN 'TERMINAL_FAILED' ELSE state END,updated_at=? WHERE provider_run_id=?`).bind(run.defaultDatasetId||null,run.status||'UNKNOWN',cost,cost,run.status||'',new Date().toISOString(),run.id).run();
}
export async function captureAcquisitionRaw(env,{run,rows}){
 if(!env.DB||!env.ARCHIVE||!run?.id||!terminal.has(run.status)||!Array.isArray(rows))throw Error('raw-capture-contract-invalid');
 const acquiredAt=run.finishedAt||run.startedAt;
 if(!acquiredAt||!Number.isFinite(Date.parse(acquiredAt)))throw Error('source-time-required');
 const key=`raw/apify/${run.id}/dataset.json`,payload=JSON.stringify({schemaVersion:1,runId:run.id,datasetId:run.defaultDatasetId,acquiredAt,rows});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload)),hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const existing=await env.ARCHIVE.head(key);
 if(existing&&existing.customMetadata?.sha256!==hash)throw Error('immutable-raw-conflict');
 if(!existing)await env.ARCHIVE.put(key,payload,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:hash,immutable:'true',acquiredAt}});
 await recordAcquisitionRun(env,run);
 await env.DB.prepare("UPDATE external_acquisitions SET state='CAPTURED',raw_key=?,raw_hash=?,observations_returned=?,captured_at=?,updated_at=? WHERE provider_run_id=?").bind(key,hash,rows.length,acquiredAt,new Date().toISOString(),run.id).run();
 return {key,hash,acquiredAt};
}

export async function recordAcquisitionConsumer(env,{providerRunId,component,sport='shared',accepted,duplicates,rejected}){
 if(!env.DB||!providerRunId)return;
 const source=await env.DB.prepare('SELECT id FROM external_acquisitions WHERE provider_run_id=?').bind(providerRunId).first();
 if(!source)return;
 await env.DB.prepare(`INSERT INTO external_acquisition_consumers(acquisition_id,component,sport,requested_at,accepted,duplicates,rejected,consumed_at) VALUES(?,?,?,?,?,?,?,?)
 ON CONFLICT(acquisition_id,component,sport) DO UPDATE SET accepted=excluded.accepted,duplicates=excluded.duplicates,rejected=excluded.rejected,consumed_at=excluded.consumed_at`).bind(source.id,component,sport,new Date().toISOString(),accepted??null,duplicates??null,rejected??null,new Date().toISOString()).run();
}
