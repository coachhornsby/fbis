// One coordinator per Cloudflare account, used only for bounded job admission.
// Reservations are never refunded: delayed billing and failed jobs cannot free
// capacity for another run. This is an application stop, not a provider hard cap.
export const STOP_MICRO_USD = 8_000_000;
const integer = n => Number.isSafeInteger(n) && n >= 0;

export async function reserveJob(storage, policy, request, now = Date.now()) {
  if (!policy || policy.enabled !== true) return {allowed:false, reason:'PAUSED'};
  const {startMs,endMs,measuredAtMs,expiresAtMs,committedMicroUsd} = policy;
  if (![startMs,endMs,measuredAtMs,expiresAtMs,committedMicroUsd].every(integer) ||
      !(startMs<=now && now<endMs && measuredAtMs<=now && now<expiresAtMs) ||
      now-measuredAtMs>900_000 || expiresAtMs-measuredAtMs>900_000)
    return {allowed:false,reason:'MISSING_OR_STALE_COST_EVIDENCE'};
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(request?.id || '') || ['__proto__','constructor','prototype'].includes(request.id))
    return {allowed:false,reason:'INVALID_JOB_ID'};
  const job = policy.jobs?.[request.job];
  if (!job || !integer(job.worstCaseMicroUsd) || job.worstCaseMicroUsd<1)
    return {allowed:false,reason:'UNAPPROVED_JOB'};
  return storage.transaction(async txn => {
    const key = `period:${startMs}:${endMs}`;
    const state = await txn.get(key) || {reserved:0,ids:{}};
    if (!integer(state.reserved) || !state.ids || Object.keys(state.ids).length>=10_000)
      return {allowed:false,reason:'LEDGER_UNAVAILABLE_OR_FULL'};
    if (Object.hasOwn(state.ids,request.id)) return {allowed:false,reason:'DUPLICATE_JOB'};
    const projected = committedMicroUsd+state.reserved+job.worstCaseMicroUsd;
    if (!Number.isSafeInteger(projected) || projected>STOP_MICRO_USD)
      return {allowed:false,reason:'ACCOUNT_BUDGET_STOP'};
    const ceilings=policy.unitCeilings || {};
    const used=state.units || {};
    for (const [unit,amount] of Object.entries(job.maxUnits || {})) {
      if (!integer(amount) || !integer(ceilings[unit]) || !integer(used[unit] || 0) ||
          !Number.isSafeInteger((used[unit] || 0)+amount) || (used[unit] || 0)+amount>ceilings[unit])
        return {allowed:false,reason:'ACCOUNT_UNIT_STOP'};
    }
    if (!Object.keys(job.maxUnits || {}).length) return {allowed:false,reason:'MISSING_UNIT_BOUNDS'};
    state.reserved += job.worstCaseMicroUsd;
    state.ids[request.id]={job:request.job,at:now};
    state.units={...used};
    for(const [unit,amount] of Object.entries(job.maxUnits))state.units[unit]=(state.units[unit] || 0)+amount;
    await txn.put(key,state);
    return {allowed:true,id:request.id,job:request.job,maxUnits:job.maxUnits,
      reservedMicroUsd:job.worstCaseMicroUsd,projectedMicroUsd:projected};
  });
}

export async function requireJobAdmission(env, job, id) {
  if (!env?.FBIS_ACCOUNT_BUDGET?.getByName || !env.CLOUDFLARE_ACCOUNT_ID)
    throw Error('ACCOUNT_BUDGET_BINDING_REQUIRED');
  const result=await env.FBIS_ACCOUNT_BUDGET.getByName(env.CLOUDFLARE_ACCOUNT_ID).reserve({job,id});
  if (!result?.allowed) throw Error(result?.reason || 'ACCOUNT_BUDGET_UNAVAILABLE');
  return result;
}
