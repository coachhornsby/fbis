import {requireJobAdmission} from './admission.mjs';
import {createExecutionLease,executionEnv} from './execution.mjs';
import {CERTIFIED_EXECUTION_JOBS} from './executionJobs.mjs';
// Both hops obtain independent reservations; a relay grant cannot authorize
// downstream provider work. Each reservation is retained even on failure.
export async function beginJobExecution(env,job,options={}){
 const ceilings=CERTIFIED_EXECUTION_JOBS[job]?.units;
 if(!ceilings)throw Error('JOB_EXECUTION_NOT_CERTIFIED');
 const admitted=await requireJobAdmission(env,job,crypto.randomUUID());
 const maxUnits=Object.fromEntries(Object.entries(ceilings).map(([key,cap])=>[key,Number.isSafeInteger(admitted.maxUnits?.[key])&&admitted.maxUnits[key]>=0?Math.min(cap,admitted.maxUnits[key]):0]));
 return executionEnv(env,createExecutionLease({...admitted,maxUnits}),options);
}
