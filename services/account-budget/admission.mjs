import {PINNODDS_CAPTURE_JOB,PINNODDS_CAPTURE_ATTEMPT,capturePolicyError} from '../pinnodds-restart/captureContract.mjs';
import {PINNODDS_ACCOUNT_JOB,PINNODDS_ACCOUNT_ATTEMPT,accountPolicyError} from '../pinnodds-restart/accountContract.mjs';
// One coordinator per Cloudflare account, used only for bounded job admission.
// Reservations are never refunded: delayed billing and failed jobs cannot free
// capacity for another run. This is an application stop, not a provider hard cap.
import {isInspectionJob} from './executionJobs.mjs';
import {validCycleAllocation} from './cycleAllocation.mjs';
export const STOP_MICRO_USD = 8_000_000;
const integer = n => Number.isSafeInteger(n) && n >= 0;

export async function reserveJob(storage, policy, request, now = Date.now()) {
  if (!policy || policy.enabled !== true) return {allowed:false, reason:'PAUSED'};
  const {startMs,endMs,measuredAtMs,expiresAtMs,committedMicroUsd} = policy;
  const allocated=validCycleAllocation(policy,now);
  if (![startMs,endMs,measuredAtMs,expiresAtMs,committedMicroUsd].every(integer) ||
      !(startMs<=now && now<endMs && measuredAtMs<=now && now<expiresAtMs) ||
      (!allocated&&(now-measuredAtMs>900_000 || expiresAtMs-measuredAtMs>900_000)))
    return {allowed:false,reason:'MISSING_OR_STALE_COST_EVIDENCE'};
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(request?.id || '') || ['__proto__','constructor','prototype'].includes(request.id))
    return {allowed:false,reason:'INVALID_JOB_ID'};
  const job = policy.jobs && Object.hasOwn(policy.jobs,request?.job) ? policy.jobs[request.job] : null;
  if (!job || !integer(job.worstCaseMicroUsd) || job.worstCaseMicroUsd<1)
    return {allowed:false,reason:'UNAPPROVED_JOB'};
  const inspection=isInspectionJob(request.job);
  const capture=request.job===PINNODDS_CAPTURE_JOB;
  if(capture){const error=capturePolicyError(policy);if(error)return {allowed:false,reason:error};if(request.id!==PINNODDS_CAPTURE_ATTEMPT)return {allowed:false,reason:'PINNODDS_CAPTURE_FIXED_ID_REQUIRED'};}
  const account=request.job===PINNODDS_ACCOUNT_JOB;
  if(account){const error=accountPolicyError(policy);if(error)return {allowed:false,reason:error};if(request.id!==PINNODDS_ACCOUNT_ATTEMPT)return {allowed:false,reason:'PINNODDS_ACCOUNT_FIXED_ID_REQUIRED'};}
  const overhead=inspection||account||capture?job.coordinatorOverheadMicroUsd:0;
  if(!integer(overhead)||(inspection&&overhead<1))return {allowed:false,reason:'INSPECTION_COORDINATOR_OVERHEAD_NOT_APPROVED'};
  const reservedCost=job.worstCaseMicroUsd+overhead;
  if(!integer(reservedCost))return {allowed:false,reason:'INVALID_JOB_COST'};
  let transactionAttempts=0;
  return storage.transaction(async txn => {
    if((inspection||account||capture)&&++transactionAttempts>1)throw Error(capture?'PINNODDS_CAPTURE_ADMISSION_RETRY_BLOCKED':account?'PINNODDS_ACCOUNT_ADMISSION_RETRY_BLOCKED':'INSPECTION_ADMISSION_RETRY_BLOCKED');
    const key = `period:${startMs}:${endMs}`;
    const state = await txn.get(key) || {reserved:0,count:0,units:{}};
    if (!integer(state.reserved) || !integer(state.count) || !state.units ||
        typeof state.units!=='object' || state.count>=(allocated?150_000:10_000))
      return {allowed:false,reason:'LEDGER_UNAVAILABLE_OR_FULL'};
    if((account||capture)&&new TextEncoder().encode(JSON.stringify(state)).length>8192)return {allowed:false,reason:capture?'PINNODDS_CAPTURE_LEDGER_STATE_TOO_LARGE':'PINNODDS_ACCOUNT_LEDGER_STATE_TOO_LARGE'};
    const reservationKey=`${key}:job:${request.id}`;
    if (await txn.get(reservationKey)) return {allowed:false,reason:'DUPLICATE_JOB'};
    const projected = committedMicroUsd+state.reserved+reservedCost;
    if(allocated&&state.reserved+reservedCost>policy.cycleAllocation.maxReservedMicroUsd)
      return {allowed:false,reason:'CYCLE_ALLOCATION_EXHAUSTED'};
    if (!Number.isSafeInteger(projected) || projected>STOP_MICRO_USD)
      return {allowed:false,reason:'ACCOUNT_BUDGET_STOP'};
    const ceilings=policy.unitCeilings || {};
    const used=state.units || {};
    for (const [unit,amount] of Object.entries(job.maxUnits || {})) {
      if (!integer(amount) || !Object.hasOwn(ceilings,unit) || !integer(ceilings[unit]) || !integer(used[unit] || 0) ||
          !Number.isSafeInteger((used[unit] || 0)+amount) || (used[unit] || 0)+amount>ceilings[unit])
        return {allowed:false,reason:'ACCOUNT_UNIT_STOP'};
    }
    if (!Object.keys(job.maxUnits || {}).length) return {allowed:false,reason:'MISSING_UNIT_BOUNDS'};
    state.reserved += reservedCost;
    state.count += 1;
    state.units={...used};
    for(const [unit,amount] of Object.entries(job.maxUnits))state.units[unit]=(state.units[unit] || 0)+amount;
    if((account||capture)&&new TextEncoder().encode(JSON.stringify(state)).length>8192)return {allowed:false,reason:capture?'PINNODDS_CAPTURE_LEDGER_STATE_TOO_LARGE':'PINNODDS_ACCOUNT_LEDGER_STATE_TOO_LARGE'};
    await txn.put(reservationKey,{job:request.job,at:now});
    await txn.put(key,state);
    return {allowed:true,id:request.id,job:request.job,maxUnits:job.maxUnits,expiresAtMs:Math.min(expiresAtMs,now+110_000),
      reservedMicroUsd:reservedCost,projectedMicroUsd:projected};
  });
}

export async function requireJobAdmission(env, job, id) {
  if (!env?.FBIS_ACCOUNT_BUDGET?.getByName || !env.CLOUDFLARE_ACCOUNT_ID)
    throw Error('ACCOUNT_BUDGET_BINDING_REQUIRED');
  const result=await env.FBIS_ACCOUNT_BUDGET.getByName(env.CLOUDFLARE_ACCOUNT_ID).reserve({job,id});
  if (!result?.allowed) throw Error(result?.reason || 'ACCOUNT_BUDGET_UNAVAILABLE');
  return result;
}
