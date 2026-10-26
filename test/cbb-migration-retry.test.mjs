import test from 'node:test';import assert from 'node:assert/strict';
import {retryCbbMigration} from '../scripts/lib/cbbMigrationRetry.mjs';
test('lock retries resume operation and record attempts without skipping the failed page',async()=>{
 let calls=0;const retries=[];const result=await retryCbbMigration(async()=>{calls++;if(calls<3)return {ok:false,error:'D1_ERROR: Currently processing a long-running import.'};return {ok:true,cursor:'saved'};},{sleep:async()=>{},onRetry:r=>retries.push(r)});
 assert.equal(calls,3);assert.equal(retries.length,2);assert.equal(result.cursor,'saved');
});
test('exhausted contention and permanent record failures remain hard failures',async()=>{
 let calls=0;await assert.rejects(retryCbbMigration(async()=>{calls++;throw Error('database is locked');},{attempts:2,sleep:async()=>{}}),/locked/);assert.equal(calls,2);
 for(const message of ['CBB_SCHEMA_CONTRACT_MISMATCH','RECORD_MISMATCH_STOP','CBB_CORE_APPROVAL_UNAVAILABLE']){
 let n=0;await assert.rejects(retryCbbMigration(async()=>{n++;throw Error(message);},{sleep:async()=>{}}),new RegExp(message));assert.equal(n,1);}
});
