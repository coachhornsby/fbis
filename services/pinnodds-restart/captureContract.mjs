// Code certification only. This does not create a policy entry or enable a route.
export const PINNODDS_CAPTURE_JOB='services/pinnodds-restart/once.mjs';
export const PINNODDS_CAPTURE_ATTEMPT='pinnodds-football-prematch-restart-v1';
export const PINNODDS_CAPTURE_OVERHEAD=Object.freeze({pinnoddsCaptureAttempts:1,coordinatorCalls:1,coordinatorStorageGets:2,coordinatorStoragePuts:2});
export const PINNODDS_CAPTURE_UNITS=Object.freeze({requests:4,responseBytes:2293760,r2Reads:0,r2Writes:3,r2Bytes:2162688,r2Lists:0,d1Queries:0,reads:0,writes:0,...PINNODDS_CAPTURE_OVERHEAD});
export function capturePolicyError(policy){
 const job=policy?.jobs?.[PINNODDS_CAPTURE_JOB];
 if(!job)return 'PINNODDS_CAPTURE_JOB_NOT_ADMITTED';
 if(job.fixedReservationId!==PINNODDS_CAPTURE_ATTEMPT||job.preAdmissionAttemptCeiling!==1||job.coordinatorTransactionAttempts!==1||job.runtimeCpuLimitMs!==100||job.coordinatorCpuLimitMs!==10||policy.unitCeilings?.pinnoddsCaptureAttempts!==1)return 'PINNODDS_CAPTURE_OVERHEAD_NOT_APPROVED';
 if(!Number.isSafeInteger(job.coordinatorOverheadMicroUsd)||job.coordinatorOverheadMicroUsd<1||!Number.isSafeInteger(job.worstCaseMicroUsd)||job.worstCaseMicroUsd<1)return 'PINNODDS_CAPTURE_COST_NOT_APPROVED';
 if(job.costCertificate?.includesBillingRounding!==true||job.costCertificate?.includesRetainedStorage!==true||job.costCertificate?.includesCoordinatorDuration!==true||!Number.isSafeInteger(policy.endMs)||policy.endMs<=0||job.costCertificate?.coveredThroughMs!==policy.endMs||!/^\w[\w.-]{0,99}$/.test(job.costCertificate?.evidenceId||'')||!/^[a-f0-9]{64}$/.test(job.costCertificate?.sha256||''))return 'PINNODDS_CAPTURE_COST_EVIDENCE_REQUIRED';
 const units=job.maxUnits||{};
 if(Object.keys(units).length!==Object.keys(PINNODDS_CAPTURE_UNITS).length||Object.entries(PINNODDS_CAPTURE_UNITS).some(([k,v])=>units[k]!==v))return 'PINNODDS_CAPTURE_EXACT_UNITS_REQUIRED';
 return null;
}
