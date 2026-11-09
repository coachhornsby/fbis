// Pure additive policy planner. Does not deploy, reserve, read R2 or enable routes.
import {validCycleAllocation} from '../account-budget/cycleAllocation.mjs';
import {CERTIFIED_EXECUTION_JOBS,executionPolicyError,NFL_SNAPSHOT_INSPECTION_JOB,NFL_SNAPSHOT_WRITE_JOB,NFL_SNAPSHOT_VERIFY_JOB,NFL_PACKET_INSPECT_JOB,NFL_PACKET_WRITE_JOB,NFL_PACKET_VERIFY_JOB} from '../account-budget/executionJobs.mjs';
export const NFL_ACTIVATION_JOBS=Object.freeze([NFL_SNAPSHOT_INSPECTION_JOB,NFL_SNAPSHOT_WRITE_JOB,NFL_SNAPSHOT_VERIFY_JOB,NFL_PACKET_INSPECT_JOB,NFL_PACKET_WRITE_JOB,NFL_PACKET_VERIFY_JOB]);
const addedUnits=new Set(['inspectionAttempts','snapshotWriteAttempts','snapshotVerifyAttempts','nflPacketInspectAttempts','nflPacketWriteAttempts','nflPacketVerifyAttempts','coordinatorCalls','coordinatorStorageGets','coordinatorStoragePuts']);
const whole=n=>Number.isSafeInteger(n)&&n>=0;
const record=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
export function planNflBudgetActivation({policy,ledger,reviewedCosts,now=Date.now()}){
 if(!record(policy)||!record(policy.jobs)||!record(policy.unitCeilings)||!record(policy.cycleAllocation)||!record(ledger)||!record(ledger.remainingUnits)||!record(reviewedCosts))throw Error('PLAIN_RECORD_INPUTS_REQUIRED');
 if(!Object.values(policy.unitCeilings).every(whole)||!Object.values(ledger.remainingUnits).every(whole))throw Error('INTEGER_UNIT_CEILINGS_REQUIRED');
 if(!whole(now)||policy?.enabled!==true||!['startMs','endMs','measuredAtMs','expiresAtMs','committedMicroUsd'].every(k=>whole(policy?.[k]))||!(policy.startMs<=now&&now<policy.endMs&&policy.measuredAtMs<=now&&now<policy.expiresAtMs)||!validCycleAllocation(policy,now))throw Error('VALID_EXISTING_ALLOCATION_REQUIRED');
 if(ledger?.ok!==true||ledger.scope!=='APPLICATION_RESERVATION_LEDGER_NOT_BILLING'||ledger.admissionGranted!==false||!whole(ledger.observedAtMs)||ledger.observedAtMs>now||now-ledger.observedAtMs>300000||ledger.startMs!==policy.startMs||ledger.endMs!==policy.endMs||ledger.policyExpiresAtMs!==policy.expiresAtMs)throw Error('FRESH_MATCHING_LEDGER_REQUIRED');
 if(!whole(ledger.reservedMicroUsd)||!whole(ledger.remainingMicroUsd)||ledger.reservedMicroUsd+ledger.remainingMicroUsd!==policy.cycleAllocation.maxReservedMicroUsd||!whole(ledger.reservationCount)||ledger.reservationCount+NFL_ACTIVATION_JOBS.length>150000)throw Error('LEDGER_ALLOCATION_INVALID');
 if(!reviewedCosts||Object.keys(reviewedCosts).sort().join('|')!==[...NFL_ACTIVATION_JOBS].sort().join('|'))throw Error('EXACT_REVIEWED_COSTS_REQUIRED');
 const next=structuredClone(policy),totalUnits={};let reservedMicroUsd=0;
 for(const job of NFL_ACTIVATION_JOBS){
  if(Object.hasOwn(next.jobs||{},job))throw Error('NFL_JOB_ALREADY_PRESENT_RECONCILE_REQUIRED');
  const cost=reviewedCosts[job],cert=CERTIFIED_EXECUTION_JOBS[job];
  if(!record(cost)||Object.keys(cost).sort().join(',')!=='coordinatorOverheadMicroUsd,worstCaseMicroUsd'||!whole(cost.worstCaseMicroUsd)||cost.worstCaseMicroUsd<1||!whole(cost.coordinatorOverheadMicroUsd)||cost.coordinatorOverheadMicroUsd<1)throw Error('EXACT_REVIEWED_COSTS_REQUIRED');
  reservedMicroUsd+=cost.worstCaseMicroUsd+cost.coordinatorOverheadMicroUsd;
  if(!whole(reservedMicroUsd))throw Error('COST_OVERFLOW');
  next.jobs[job]={...cost,maxUnits:structuredClone(cert.units),runtimeCpuLimitMs:cert.cpuMs,preAdmissionAttemptCeiling:1};
  for(const [unit,value]of Object.entries(cert.units))totalUnits[unit]=(totalUnits[unit]||0)+value;
 }
 if(reservedMicroUsd>ledger.remainingMicroUsd||policy.committedMicroUsd+ledger.reservedMicroUsd+reservedMicroUsd>8000000)throw Error('INSUFFICIENT_EXISTING_ALLOCATION');
 for(const [unit,value]of Object.entries(totalUnits)){
  if(!whole(value))throw Error('UNIT_OVERFLOW');
  if(Object.hasOwn(policy.unitCeilings,unit)){
   if(!whole(ledger.remainingUnits?.[unit])||ledger.remainingUnits[unit]>policy.unitCeilings[unit]||ledger.remainingUnits[unit]<value)throw Error('INSUFFICIENT_EXISTING_UNITS_'+unit);
  }else if(addedUnits.has(unit))next.unitCeilings[unit]=value;
  else throw Error('UNREVIEWED_NEW_UNIT_'+unit);
 }
 for(const job of NFL_ACTIVATION_JOBS){const err=executionPolicyError(next,job);if(err)throw Error(err);}
 if(!validCycleAllocation(next,now))throw Error('ALLOCATION_CHANGED');
 return {policy:next,plan:{schema:'nfl-single-date-budget-plan-v1',newJobs:[...NFL_ACTIVATION_JOBS],maxAdditionalReservedMicroUsd:reservedMicroUsd,totalUnits,scope:'ONE_SOURCE_ENVELOPE_AND_ONE_OUTPUT_DATE',activationPerformed:false,providerBillingVerified:false}};
}
