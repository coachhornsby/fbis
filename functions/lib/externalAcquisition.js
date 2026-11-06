import { retiredProviderResponse } from './retiredProviderPolicy.js';
import { sha256Hex } from './sha256Hex.js';

// Operator hard ceiling: each paid Actor launch may cost no more than USD $0.70.
export const FBIS_MAX_PAID_PULL_USD = 0.70;

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
export async function startPaidAcquisition() {
 return retiredProviderResponse();
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
