// Internal service-binding path only. No public HTTP route, caller-selected key,
// source fanout, writes, lists or retry. Deployment does not grant budget policy.
import {requireJobAdmission} from '../account-budget/admission.mjs';
import {createExecutionLease,executionR2} from '../account-budget/execution.mjs';
import {NFL_SNAPSHOT_INSPECTION_JOB,NFL_SNAPSHOT_VERIFY_JOB,CERTIFIED_EXECUTION_JOBS} from '../account-budget/executionJobs.mjs';
export const NFL_FEATURE_KEY='nfl/features/latest.json';
export const NFL_INSPECTION_ID='fbis-nfl-feature-inspection-v1';
export const NFL_VERIFY_ID='fbis-nfl-feature-verify-v1';
export const inspectNflFeatureSnapshot=env=>readOnce(env,NFL_SNAPSHOT_INSPECTION_JOB,NFL_INSPECTION_ID,'inspectionAttempts');
export const verifyNflFeatureSnapshot=env=>readOnce(env,NFL_SNAPSHOT_VERIFY_JOB,NFL_VERIFY_ID,'snapshotVerifyAttempts');
async function readOnce(env,job,id,attemptUnit){
 if(!env?.R2_ARCHIVE?.get)throw Error('NFL_ARCHIVE_BINDING_REQUIRED');
 const grant=await requireJobAdmission(env,job,id);
 if(grant.id!==id||grant.job!==job)throw Error('NFL_ADMISSION_IDENTITY');
 const caps=CERTIFIED_EXECUTION_JOBS[job].units;
 if(Object.keys(grant.maxUnits||{}).length!==Object.keys(caps).length||Object.entries(caps).some(([k,v])=>grant.maxUnits[k]!==v))throw Error('NFL_ADMISSION_EXACT_UNITS');
 const lease=createExecutionLease(grant);
 lease.spend({[attemptUnit]:1,coordinatorCalls:1,coordinatorStorageGets:2,coordinatorStoragePuts:2});
 const object=await executionR2(env.R2_ARCHIVE,lease).get(NFL_FEATURE_KEY);lease.live();
 if(!object&&job===NFL_SNAPSHOT_INSPECTION_JOB)return {schema:'nfl-feature-inspection-v1',key:NFL_FEATURE_KEY,found:false,etag:null,snapshotSha256:null,bytes:0,inspectedAt:new Date().toISOString(),budget:lease.snapshot(),productionAuthority:false,canAuthorizeWager:false};
 if(!object?.body)lease.stop('NFL_SNAPSHOT_MISSING');
 // executionR2 rejects declared sizes over 8 MiB and streams exceeding size.
 const raw=new Uint8Array(await new Response(object.body).arrayBuffer());lease.live();
 if(raw.length!==object.size)lease.stop('NFL_SNAPSHOT_LENGTH_MISMATCH');
 const snapshotSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
 const snapshotText=new TextDecoder('utf-8',{fatal:true}).decode(raw);lease.live();
 // This proves a bounded retrieval, not upstream freshness or model admission.
 // Consumer must validate independent source receipt, season, coverage and time.
 return {schema:'nfl-feature-inspection-v1',key:NFL_FEATURE_KEY,found:true,etag:typeof object.etag==='string'&&object.etag.length<=128?object.etag:null,predecessorBuiltAt:typeof object.customMetadata?.builtAt==='string'&&object.customMetadata.builtAt.length<=40?object.customMetadata.builtAt:null,snapshotText,snapshotSha256,
  bytes:raw.length,inspectedAt:new Date().toISOString(),budget:lease.snapshot(),
  sourceFreshnessVerified:false,productionAuthority:false,canAuthorizeWager:false};
}
