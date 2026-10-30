import {requireJobAdmission} from './admission.mjs';
import {createExecutionLease,executionEnv} from './execution.mjs';
import {CERTIFIED_EXECUTION_JOBS} from './executionJobs.mjs';
// Both hops obtain independent reservations; a relay grant cannot authorize
// downstream provider work. Each reservation is retained even on failure.
export async function reserveJobExecution(env,job,options={}){
 const ceilings=CERTIFIED_EXECUTION_JOBS[job]?.units;
 if(!ceilings)throw Error('JOB_EXECUTION_NOT_CERTIFIED');
 const {reservationId=crypto.randomUUID(),...executionOptions}=options;
 const admitted=await requireJobAdmission(env,job,reservationId);
 const maxUnits=Object.fromEntries(Object.entries(ceilings).map(([key,cap])=>[key,Number.isSafeInteger(admitted.maxUnits?.[key])&&admitted.maxUnits[key]>=0?Math.min(cap,admitted.maxUnits[key]):0]));
 const lease=createExecutionLease({...admitted,maxUnits});
 return {lease,env:executionEnv(env,lease,executionOptions)};
}

export async function beginJobExecution(env,job,options={}){return (await reserveJobExecution(env,job,options)).env;}
