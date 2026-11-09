// Code certification only. This does not create a policy entry or enable a route.
export const PINNODDS_ACCOUNT_JOB='services/pinnodds-restart/once.mjs:account';
export const PINNODDS_ACCOUNT_ATTEMPT='pinnodds-account-check-v1';
export const PINNODDS_ACCOUNT_OVERHEAD=Object.freeze({pinnoddsAccountAttempts:1,coordinatorCalls:1,coordinatorStorageGets:2,coordinatorStoragePuts:2});
export const PINNODDS_ACCOUNT_UNITS=Object.freeze({requests:3,responseBytes:196608,r2Reads:0,r2Writes:2,r2Bytes:4096,r2Lists:0,d1Queries:0,reads:0,writes:0,...PINNODDS_ACCOUNT_OVERHEAD});
export function accountPolicyError(policy){
 const job=policy?.jobs?.[PINNODDS_ACCOUNT_JOB];
 if(!job)return 'PINNODDS_ACCOUNT_JOB_NOT_ADMITTED';
 if(job.fixedReservationId!==PINNODDS_ACCOUNT_ATTEMPT||job.preAdmissionAttemptCeiling!==1||job.coordinatorTransactionAttempts!==1||job.runtimeCpuLimitMs!==100||job.coordinatorCpuLimitMs!==10||policy.unitCeilings?.pinnoddsAccountAttempts!==1)return 'PINNODDS_ACCOUNT_OVERHEAD_NOT_APPROVED';
 if(!Number.isSafeInteger(job.coordinatorOverheadMicroUsd)||job.coordinatorOverheadMicroUsd<1||!Number.isSafeInteger(job.worstCaseMicroUsd)||job.worstCaseMicroUsd<1)return 'PINNODDS_ACCOUNT_COST_NOT_APPROVED';
 if(job.costCertificate?.includesBillingRounding!==true||job.costCertificate?.includesRetainedStorage!==true||job.costCertificate?.includesCoordinatorDuration!==true||!Number.isSafeInteger(policy.endMs)||policy.endMs<=0||job.costCertificate?.coveredThroughMs!==policy.endMs||!/^\w[\w.-]{0,99}$/.test(job.costCertificate?.evidenceId||'')||!/^[a-f0-9]{64}$/.test(job.costCertificate?.sha256||''))return 'PINNODDS_ACCOUNT_COST_EVIDENCE_REQUIRED';
 const units=job.maxUnits||{};
 if(Object.keys(units).length!==Object.keys(PINNODDS_ACCOUNT_UNITS).length||Object.entries(PINNODDS_ACCOUNT_UNITS).some(([k,v])=>units[k]!==v))return 'PINNODDS_ACCOUNT_EXACT_UNITS_REQUIRED';
 return null;
}
