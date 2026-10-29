import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {createExecutionLease,executionFetch,executionR2,executionD1,executionEnv} from '../services/account-budget/execution.mjs';
const grant=(units,expiresAtMs=Date.now()+60000)=>({allowed:true,expiresAtMs,maxUnits:units});
test('concurrent operations reserve before IO and never exceed their allowance',async()=>{
 const lease=createExecutionLease(grant({requests:3,responseBytes:100}));let calls=0;
 const get=executionFetch(lease,async()=>{calls++;return new Response('ok');},{origin:'https://provider.test',path:'/events'});
 await Promise.allSettled(Array.from({length:50},()=>get('https://provider.test/events')));assert.equal(calls,3);
});
test('chunked responses stop at the byte ceiling and stop later IO',async()=>{
 const lease=createExecutionLease(grant({requests:2,responseBytes:4}));let calls=0;
 const get=executionFetch(lease,async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('12345'));c.close();}}));},{origin:'https://provider.test',path:'/events'});
 await assert.rejects(async()=>{await (await get('https://provider.test/events')).text();},/UNIT_LIMIT/);
 await assert.rejects(()=>get('https://provider.test/events'),/STOPPED/);assert.equal(calls,1);
});
test('lease expiry blocks delayed callbacks; mutation of the admission cannot extend a lease',async()=>{
 let clock=1000;const admission=grant({r2Writes:1,r2Bytes:4},2000);const lease=createExecutionLease(admission,{now:()=>clock});admission.expiresAtMs=999999;
 let calls=0;const r2=executionR2({put(){calls++;}},lease);clock=2000;await assert.rejects(()=>r2.put('key','body'),/EXPIRED/);assert.equal(calls,0);
});
test('oversized and unknown-length archive writes fail before touching R2',async()=>{
 let calls=0;const bucket={put(){calls++;}};
 await assert.rejects(()=>executionR2(bucket,createExecutionLease(grant({r2Writes:1,r2Bytes:2}))).put('x','large'),/UNIT_LIMIT/);
 await assert.rejects(()=>executionR2(bucket,createExecutionLease(grant({r2Writes:1,r2Bytes:2}))).put('x',new ReadableStream()),/UNBOUNDED/);assert.equal(calls,0);
});
test('SQL counts, sorts, joins and mutations are rejected before the database is touched',async()=>{
 let calls=0;const db={prepare(){calls++;}};
 for(const sql of ['SELECT COUNT(*) FROM normalized_market_observations','SELECT * FROM normalized_market_observations ORDER BY collected_at LIMIT 1','DELETE FROM normalized_market_observations']){
 const d1=executionD1(db,createExecutionLease(grant({d1Queries:1,reads:2,writes:0})));
 await assert.rejects(()=>d1.prepare(sql).all(),/NOT_CERTIFIED/);
 }assert.equal(calls,0);
});
test('certified primary-key reads work on SQLite and fail before the next query exceeds its budget',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE normalized_market_observations(id TEXT PRIMARY KEY,collected_at TEXT)');db.prepare('INSERT INTO normalized_market_observations VALUES(?,?)').run('one','clock');let calls=0;
 const adapter={prepare(sql){calls++;return{bind(...args){return{async all(){return{results:db.prepare(sql).all(...args),meta:{rows_read:1,rows_written:0}}}}}}}};
 const d1=executionD1(adapter,createExecutionLease(grant({d1Queries:1,reads:2,writes:0})));
 assert.equal((await d1.prepare('SELECT id,collected_at FROM normalized_market_observations WHERE id=?').bind('one').all()).results[0].collected_at,'clock');
 await assert.rejects(()=>d1.prepare('SELECT id,collected_at FROM normalized_market_observations WHERE id=?').bind('one').all(),/UNIT_LIMIT/);assert.equal(calls,1);db.close();
});
test('mixed or oversized batches and unbudgeted service/actor bindings cannot bypass the boundary',async()=>{
 let calls=0;const lease=createExecutionLease(grant({d1Queries:2,reads:4,writes:0}));const d1=executionD1({batch(){calls++;}},lease);
 await assert.rejects(()=>d1.batch([{}]),/NOT_CERTIFIED/);assert.equal(calls,0);
 const env=executionEnv({ACTOR:{getByName(){calls++;}}},createExecutionLease(grant({requests:0})));
 assert.throws(()=>env.ACTOR,/UNBUDGETED/);assert.equal(calls,0);
});
test('provider redirects are manual and destinations or write methods outside the approved route are denied',async()=>{
 let calls=0;let redirect;
 const get=()=>executionFetch(createExecutionLease(grant({requests:1,responseBytes:100})),async(_u,init)=>{calls++;redirect=init.redirect;return new Response(null,{status:302,headers:{location:'https://elsewhere.test'}});},{origin:'https://provider.test',path:'/events'});
 assert.equal((await get()('https://provider.test/events')).status,302);assert.equal(redirect,'manual');
 await assert.rejects(()=>get()('https://provider.test/elsewhere'),/NOT_APPROVED/);
 await assert.rejects(()=>get()('https://provider.test/events',{method:'POST'}),/NOT_APPROVED/);assert.equal(calls,1);
});

test('archive size is reserved before exposing its body and delayed reads honor expiry',async()=>{
 let clock=1000,reads=0;
 const bucket={async get(){reads++;return{size:5,body:new Response('hello').body};}};
 await assert.rejects(()=>executionR2(bucket,createExecutionLease(grant({r2Reads:1,r2Bytes:4}))).get('key'),/UNIT_LIMIT/);assert.equal(reads,1);
 const lease=createExecutionLease(grant({r2Reads:1,r2Bytes:5},2000),{now:()=>clock});const object=await executionR2(bucket,lease).get('key');clock=2000;
 await assert.rejects(()=>object.text(),/EXPIRED/);
});

test('policy cannot raise code ceilings, authorize SQL writes, or activate an unported job',async()=>{
 const {executionPolicyError,TENNIS_COLLECT_JOB}=await import('../services/account-budget/executionJobs.mjs');
 const policy=maxUnits=>({jobs:{[TENNIS_COLLECT_JOB]:{maxUnits}}});
 assert.equal(executionPolicyError(policy({requests:36}),TENNIS_COLLECT_JOB),null);
 for(const maxUnits of [{requests:37},{writes:1},{r2Writes:3},{responseBytes:8388609},{unknown:1}])assert.equal(executionPolicyError(policy(maxUnits),TENNIS_COLLECT_JOB),'JOB_POLICY_EXCEEDS_CODE_CEILINGS');
 assert.equal(executionPolicyError({jobs:{legacy:{maxUnits:{requests:1}}}},'legacy'),'JOB_EXECUTION_NOT_CERTIFIED');
});
