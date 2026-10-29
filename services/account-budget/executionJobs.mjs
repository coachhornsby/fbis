// Code approval is required as well as billing policy. Config cannot activate a
// legacy job that has no execution boundary. These jobs make no D1 mutations.
export const TENNIS_COLLECT_JOB='services/polymarket-tennis-collector/index.js';
export const TENNIS_HEALTH_JOB=TENNIS_COLLECT_JOB+':health';
export const CERTIFIED_EXECUTION_JOBS=Object.freeze({
 [TENNIS_COLLECT_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({requests:36,responseBytes:8388608,r2Reads:0,r2Writes:2,r2Lists:0,r2Bytes:4194304,d1Queries:0,reads:0,writes:0})}),
 [TENNIS_HEALTH_JOB]:Object.freeze({cpuMs:100,units:Object.freeze({requests:0,responseBytes:0,r2Reads:1,r2Writes:0,r2Lists:0,r2Bytes:65536,d1Queries:0,reads:0,writes:0})})
});
export function executionPolicyError(policy,job){
 if(!Object.hasOwn(CERTIFIED_EXECUTION_JOBS,job||''))return 'JOB_EXECUTION_NOT_CERTIFIED';
 const units=policy?.jobs?.[job]?.maxUnits;
 if(!units||!Object.keys(units).length)return 'MISSING_UNIT_BOUNDS';
 const caps=CERTIFIED_EXECUTION_JOBS[job].units;
 for(const [unit,value]of Object.entries(units))if(!Object.hasOwn(caps,unit)||!Number.isSafeInteger(value)||value<0||value>caps[unit])return 'JOB_POLICY_EXCEEDS_CODE_CEILINGS';
 return null;
}
