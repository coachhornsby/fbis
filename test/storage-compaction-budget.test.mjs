import test from 'node:test';
import assert from 'node:assert/strict';
import {compactionBudget,compactionPageLimit} from '../scripts/lib/storage-compaction-budget.mjs';
test('compaction has a 5000-row default and exact resume cursor',()=>{
 assert.deepEqual(compactionBudget(),{startRowid:0,maxRows:5000});
 assert.deepEqual(compactionBudget({startRowid:'509110',maxRows:'5000'}),{startRowid:509110,maxRows:5000});
 assert.equal(compactionPageLimit(0,5000),500);
 assert.equal(compactionPageLimit(4998,5000),2);
 assert.equal(compactionPageLimit(5000,5000),0);
});
test('compaction refuses malformed, unlimited or negative budgets',()=>{
 for(const opts of [{maxRows:0},{maxRows:10001},{maxRows:'Infinity'},{maxRows:'foo'},
 {maxRows:1.5},{startRowid:-1},{startRowid:1.5},{startRowid:Number.MAX_SAFE_INTEGER+10}]){
  assert.throws(()=>compactionBudget(opts),/INVALID_COMPACTION/);
 }
 assert.throws(()=>compactionPageLimit(501,500),/INVALID_COMPACTION_PROGRESS/);
});
