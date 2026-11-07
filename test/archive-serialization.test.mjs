import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeArchive,inspectArchiveOperation,MAX_ARCHIVE_OPERATIONS} from '../services/archive/archiveSerialization.mjs';
const intentSha256='a'.repeat(64),good={independentRestoreVerified:true,manifestId:'verified-file',manifestSha256:'b'.repeat(64)};
function storage(){const data=new Map();let queue=Promise.resolve();return{data,transaction(fn){const work=queue.then(async()=>{const copy=new Map(structuredClone([...data]));const txn={get:async k=>structuredClone(copy.get(k)),put:async(k,v)=>copy.set(k,structuredClone(v))};const result=await fn(txn);data.clear();for(const pair of copy)data.set(...pair);return result;});queue=work.catch(()=>{});return work;}};}
test('concurrent different IDs cannot overlap or spend duplicate external IO',async()=>{
 const s=storage();let enter,release,calls=0;const entered=new Promise(r=>enter=r),blocked=new Promise(r=>release=r);
 const first=serializeArchive(s,{operationId:'one',intentSha256},async()=>{calls++;enter();await blocked;return good;});await entered;
 const others=await Promise.allSettled(Array.from({length:30},(_,i)=>serializeArchive(s,{operationId:'other'+i,intentSha256},async()=>{calls++;return good;})));
 assert.ok(others.every(r=>r.status==='rejected'&&/BUSY/.test(r.reason.message)));assert.equal(calls,1);release();assert.deepEqual(await first,good);
 assert.equal((await inspectArchiveOperation(s,'one')).operation.phase,'completed');assert.equal((await inspectArchiveOperation(s,'one')).active,null);
 await serializeArchive(s,{operationId:'next',intentSha256},async()=>good);
});
test('completed, failed, and changed-intent IDs cannot replay',async()=>{
 const s=storage();await serializeArchive(s,{operationId:'one',intentSha256},async()=>good);
 for(const hash of [intentSha256,'c'.repeat(64)])await assert.rejects(()=>serializeArchive(s,{operationId:'one',intentSha256:hash},async()=>assert.fail('must not run')),/REPLAY/);
});
test('failure is sticky across new calls and arbitrarily advanced time',async()=>{
 const s=storage();await assert.rejects(()=>serializeArchive(s,{operationId:'bad',intentSha256},async()=>{throw Error('secret must not persist');}),/UNCERTAIN/);
 const state=await inspectArchiveOperation(s,'bad');assert.equal(state.active.phase,'uncertain');assert.ok(!JSON.stringify([...s.data]).includes('secret'));
 await assert.rejects(()=>serializeArchive(s,{operationId:'later',intentSha256},async()=>assert.fail('no expiry unlock'),{now:()=>Date.now()+1000000000}),/BUSY/);
});
test('a persisted running record blocks after process loss; no TTL takeover',async()=>{
 const s=storage();s.data.set('archive:v1:active',{operationId:'crashed',intentSha256,phase:'running',startedAt:0});
 await assert.rejects(()=>serializeArchive(s,{operationId:'new',intentSha256},async()=>assert.fail('must not run')),/BUSY/);
});
test('unverified receipts and completion-storage failures never release active lock',async()=>{
 for(const kind of ['receipt','commit']){
  const s=storage(),original=s.transaction;let count=0;
  if(kind==='commit')s.transaction=fn=>{if(++count>=2)return Promise.reject(Error('storage unavailable'));return original(fn);};
  await assert.rejects(()=>serializeArchive(s,{operationId:'one',intentSha256},async()=>kind==='receipt'?{independentRestoreVerified:false}:good),/UNCERTAIN/);
  assert.ok(s.data.get('archive:v1:active'));assert.notEqual(s.data.get('archive:v1:operation:one').phase,'completed');
 }
});
test('bad input and ledger cap deny before external work',async()=>{
 const s=storage();let calls=0;await assert.rejects(()=>serializeArchive(s,{operationId:'../x',intentSha256},async()=>calls++),/INPUT/);
 s.data.set('archive:v1:count',MAX_ARCHIVE_OPERATIONS);await assert.rejects(()=>serializeArchive(s,{operationId:'one',intentSha256},async()=>calls++),/LEDGER_FULL/);assert.equal(calls,0);
});
