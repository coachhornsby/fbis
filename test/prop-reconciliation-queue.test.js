import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileQueuedPropEvidence} from '../functions/lib/propReconciliationQueue.js';
const records=new Map(),env={ARCHIVE:{get:async k=>records.has(k)?{json:async()=>JSON.parse(records.get(k))}:null,
 put:async(k,v)=>records.set(k,v)}};
test('scheduled reconciliation refuses missing approval and arbitrary identifiers',async()=>{
 assert.equal((await reconcileQueuedPropEvidence(env)).reason,'APPROVED_QUEUE_REQUIRED');
 records.set('player-props/evidence/v1/reconciliation-queue.json',JSON.stringify({version:1,approved:true,jobs:[{projectionId:'bad',marketId:'bad',resultId:'bad'}]}));
 const result=await reconcileQueuedPropEvidence(env,{now:new Date('2026-10-20T23:00:00Z')});
 assert.equal(result.ok,false);assert.equal(result.blocked,1);assert.equal(result.graded,0);
 assert.equal(result.canAuthorizeWager,false);
 assert.ok(records.has('player-props/evidence/v1/reconciliation-status.json'));
});
