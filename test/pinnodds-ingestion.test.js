import test from 'node:test';import assert from 'node:assert/strict';
import {preparePinnoddsSnapshot,consumePinnoddsSnapshot,reconcilePinnoddsSnapshot} from '../functions/lib/pinnoddsIngestion.js';
test('archived provider capture is consumed without upstream calls, replays idempotently and reconciles',async()=>{
 const snapshotId='run-1-board-6-prematch',at='2026-10-13T17:00:00Z',values=new Map(),writes=new Map();
 const receipt={ok:true,snapshotId,sportId:6,feed:'prematch',kind:'board',collectedAt:at,rawKey:'raw'};
 values.set(`market-sources/pinnodds/receipts/${snapshotId}.json`,JSON.stringify(receipt));
 values.set('raw',JSON.stringify({events:[{event_id:1,league_name:'MLB',starts:'2026-10-14T00:00:00Z',home:'Home',away:'Away',periods:{num_0:{money_line:{home:1.8,away:2.1}}}}]}));
 const env={ARCHIVE:{async get(key){return values.has(key)?{async json(){return JSON.parse(values.get(key))}}:null},async put(key,value){values.set(key,value)}},DB:{prepare(sql){return{bind(...args){return{async all(){return{results:[]}},async first(){return{n:writes.size}},async run(){const inserted=!writes.has(args[0]);writes.set(args[0],args);return{meta:{changes:inserted?1:0}}}}}}}}};
 const prepared=await preparePinnoddsSnapshot(env,{snapshotId});assert.equal(prepared.normalizedRows,2);assert.equal(prepared.batches,1);assert.equal(writes.size,0);
 assert.equal((await consumePinnoddsSnapshot(env,{snapshotId,batchIndex:0})).inserted,2);assert.equal((await consumePinnoddsSnapshot(env,{snapshotId,batchIndex:0})).inserted,0);
 const result=await reconcilePinnoddsSnapshot(env,{snapshotId});assert.equal(result.reconciled,true);assert.equal(result.persistedRows,2);
 for(const row of writes.values()){assert.equal(row[29],null);assert.equal(row[30],at);assert.equal(row[31],'RESEARCH');assert.ok(row[21]>1);}
});
