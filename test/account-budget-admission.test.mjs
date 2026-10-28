import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveJob,requireJobAdmission} from '../services/account-budget/admission.mjs';

function store(){
 const data=new Map();let tail=Promise.resolve();
 return {transaction(fn){const result=tail.then(async()=>{
  const staged=new Map([...data].map(([k,v])=>[k,structuredClone(v)]));
  const value=await fn({get:async k=>staged.get(k),put:async(k,v)=>staged.set(k,v)});
  data.clear();for(const [k,v] of staged)data.set(k,v);return value;
 });tail=result.catch(()=>{});return result;}};
}
const now=1_000_000;
const policy=()=>({enabled:true,startMs:0,endMs:2_000_000,measuredAtMs:now,
 expiresAtMs:now+60_000,committedMicroUsd:7_000_000,
 unitCeilings:{reads:10_000},jobs:{collect:{worstCaseMicroUsd:100_000,maxUnits:{reads:1000}}}});

test('100 concurrent jobs cannot reserve beyond the account ceiling',async()=>{
 const s=store();const results=await Promise.all(Array.from({length:100},(_,i)=>
 reserveJob(s,policy(),{job:'collect',id:String(i)},now)));
 assert.equal(results.filter(x=>x.allowed).length,10);
});
test('retries and re-created coordinator use persistent reservation IDs',async()=>{
 const s=store(),r={job:'collect',id:'same'};
 assert.equal((await reserveJob(s,policy(),r,now)).allowed,true);
 assert.equal((await reserveJob(s,policy(),r,now)).reason,'DUPLICATE_JOB');
});
test('missing policy, stale evidence, unavailable binding and unapproved jobs deny',async()=>{
 assert.equal((await reserveJob(store(),null,{},now)).allowed,false);
 assert.equal((await reserveJob(store(),{...policy(),expiresAtMs:now}, {},now)).allowed,false);
 assert.equal((await reserveJob(store(),policy(),{job:'unknown',id:'x'},now)).allowed,false);
 await assert.rejects(()=>requireJobAdmission({},'collect','x'),/BINDING_REQUIRED/);
});
test('unit limit stops work even with remaining dollars',async()=>{
 const p=policy();p.unitCeilings.reads=1;
 assert.equal((await reserveJob(store(),p,{job:'collect',id:'x'},now)).reason,'ACCOUNT_UNIT_STOP');
});
test('storage failure propagates and never permits execution',async()=>{
 await assert.rejects(()=>reserveJob({transaction:async()=>{throw Error('offline')}},
 policy(),{job:'collect',id:'x'},now),/offline/);
});
