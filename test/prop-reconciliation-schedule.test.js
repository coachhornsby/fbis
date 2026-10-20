import test from 'node:test';
import assert from 'node:assert/strict';
import {runApprovedPropReconciliation} from '../functions/lib/propReconciliationSchedule.js';
test('a missing manifest cannot grade a player prop',async()=>{
 const data=new Map(),env={ARCHIVE:{get:async k=>data.has(k)?{json:async()=>JSON.parse(data.get(k))}:null,put:async(k,v)=>data.set(k,v)}};
 assert.equal((await runApprovedPropReconciliation(env)).status,'NOT_CONFIGURED');
 data.set('player-props/reconcile/v1/approved-index.json',JSON.stringify({version:1,approved:true,entries:[{reviewed:false}]}));
 const r=await runApprovedPropReconciliation(env);
 assert.equal(r.graded,0);assert.equal(r.blocked,1);assert.equal(r.canAuthorizeWager,false);
 assert.ok(data.has('player-props/reconcile/v1/latest-receipt.json'));
});
