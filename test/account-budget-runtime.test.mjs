import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../services/account-budget/package.json',import.meta.url));
const {Miniflare}=require(process.env.FBIS_MINIFLARE_MODULE || 'miniflare');
const root=new URL('../services/account-budget/',import.meta.url);
const modules=await Promise.all(['worker.mjs','admission.mjs','executionJobs.mjs'].map(async name=>({
 type:'ESModule',path:new URL(name,root).pathname,contents:await readFile(new URL(name,root),'utf8')
})));
function runtime(path,policy){return new Miniflare({
 compatibilityDate:'2026-07-01',durableObjectsPersist:path,
 modules:[{type:'ESModule',path:new URL('test-entry.mjs',root).pathname,contents:`
 export {AccountBudget} from './worker.mjs';
 export default {async fetch(request,env){
 const r=await env.FBIS_ACCOUNT_BUDGET.getByName('account').reserve(await request.json());
 return Response.json(r);
 }};`},...modules],
 durableObjects:{FBIS_ACCOUNT_BUDGET:{className:'AccountBudget',useSQLite:true}},
 bindings:{FBIS_ACCOUNT_BUDGET_POLICY:JSON.stringify(policy)}
});}
async function reserve(mf,id,job='services/polymarket-tennis-collector/index.js'){
 const r=await mf.dispatchFetch('http://local.test',{method:'POST',body:JSON.stringify({id,job})});
 assert.equal(r.status,200);return r.json();
}
test('real SQLite-backed Worker RPC serializes reservations and preserves them across restart',async()=>{
 const path=await mkdtemp(join(tmpdir(),'fbis-budget-test-'));
 const now=Date.now();const policy={enabled:true,startMs:now-1000,endMs:now+3600000,
 measuredAtMs:now,expiresAtMs:now+900000,committedMicroUsd:7000000,
 unitCeilings:{requests:10},jobs:{'services/polymarket-tennis-collector/index.js':{worstCaseMicroUsd:100000,maxUnits:{requests:1}},'legacy-scanner':{worstCaseMicroUsd:1000,maxUnits:{requests:1}}}};
 let mf;
 try{
 mf=runtime(path,policy);
 assert.equal((await reserve(mf,'legacy','legacy-scanner')).reason,'JOB_EXECUTION_NOT_CERTIFIED');
 const results=await Promise.all(Array.from({length:100},(_,i)=>reserve(mf,`run-${i}`)));
 assert.equal(results.filter(r=>r.allowed).length,10);
 const admitted=results.find(r=>r.allowed);
 await mf.dispose();mf=runtime(path,policy);
 assert.equal((await reserve(mf,admitted.id)).reason,'DUPLICATE_JOB');
 assert.equal((await reserve(mf,'extra')).reason,'ACCOUNT_BUDGET_STOP');
 await mf.dispose();mf=runtime(path,{enabled:false});
 assert.equal((await reserve(mf,'paused')).reason,'PAUSED');
 }finally{if(mf)await mf.dispose();await rm(path,{recursive:true,force:true});}
});
