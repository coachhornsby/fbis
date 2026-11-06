import test from 'node:test';
import assert from 'node:assert/strict';
import {validCycleAllocation} from '../services/account-budget/cycleAllocation.mjs';
import {reserveJob} from '../services/account-budget/admission.mjs';
const day=86400000, now=30*day;
function policy(){return {enabled:true,startMs:now-10*day,endMs:now+20*day,measuredAtMs:now-day,expiresAtMs:now+20*day,committedMicroUsd:7000000,
 cycleAllocation:{version:1,ownerAuthorized:true,source:'CLOUDFLARE_BILLABLE_USAGE_BROWSER',observedUsageMicroUsd:420000,maxReservedMicroUsd:2},
 unitCeilings:{requests:500000,r2Reads:2000000,r2Writes:500000,r2Lists:0,doDurationMs:2000000000,wsMessages:8000000,d1Queries:0,reads:0,writes:0},jobs:{collect:{worstCaseMicroUsd:1,maxUnits:{requests:1}}}};}
function store(){const data=new Map();return {transaction:async fn=>fn({get:async k=>data.get(k),put:async(k,v)=>data.set(k,structuredClone(v))})};}
test('fixed allocation admits stale billing only inside its pre-funded period and stops at dollar allocation',async()=>{
 const p=policy(),s=store();assert.equal(validCycleAllocation(p,now),true);
 assert.equal((await reserveJob(s,p,{job:'collect',id:'one'},now)).allowed,true);
 assert.equal((await reserveJob(s,p,{job:'collect',id:'two'},now)).allowed,true);
 assert.equal((await reserveJob(s,p,{job:'collect',id:'three'},now)).reason,'CYCLE_ALLOCATION_EXHAUSTED');
 assert.equal((await reserveJob(store(),p,{job:'collect',id:'late'},p.endMs)).allowed,false);
});
test('unapproved, enlarged, invalid-evidence or D1 allocations retain the fifteen-minute stop',async()=>{
 for(const mutate of [p=>p.cycleAllocation.ownerAuthorized=false,p=>p.cycleAllocation.source='ASSUMED',p=>p.cycleAllocation.maxReservedMicroUsd=500001,p=>p.cycleAllocation.observedUsageMicroUsd=8000000,p=>p.committedMicroUsd=0,p=>p.unitCeilings.requests++,p=>p.unitCeilings.doDurationMs++,p=>p.unitCeilings.d1Queries=1,p=>p.expiresAtMs--,p=>p.measuredAtMs-=day]){
  const p=policy();mutate(p);assert.equal(validCycleAllocation(p,now),false);assert.equal((await reserveJob(store(),p,{job:'collect',id:'x'},now)).reason,'MISSING_OR_STALE_COST_EVIDENCE');
 }
});
test('unit quotas and duplicate IDs still stop allocated jobs',async()=>{
 const p=policy(),s=store();p.unitCeilings.requests=1;
 assert.equal((await reserveJob(s,p,{job:'collect',id:'one'},now)).allowed,true);
 assert.equal((await reserveJob(s,p,{job:'collect',id:'one'},now)).reason,'DUPLICATE_JOB');
 assert.equal((await reserveJob(s,p,{job:'collect',id:'two'},now)).reason,'ACCOUNT_UNIT_STOP');
});
