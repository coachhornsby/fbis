import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {persistPropEvidence,readPropEvidence} from '../functions/lib/propEvidenceStore.js';
const data={schemaVersion:1,kind:'OFFICIAL_RESULT',observedAt:'2026-10-20T23:00:00Z',canonicalEventId:'e',canonicalPlayerId:'p',sourceId:'official:g1',stat:'shots',actual:3};
const memory=new Map();
const bucket={async get(k){return memory.has(k)?{text:async()=>memory.get(k),json:async()=>JSON.parse(memory.get(k))}:null;},async put(k,v){memory.set(k,v);}};
test('R2 content-addressed evidence readback, idempotence and tamper detection',async()=>{
 const a=await persistPropEvidence({ARCHIVE:bucket},data,{webCrypto:webcrypto});
 assert.equal(a.ok,true);assert.equal(a.existed,false);assert.equal(a.canAuthorizeWager,false);
 const b=await persistPropEvidence({ARCHIVE:bucket},data,{webCrypto:webcrypto});assert.equal(b.ok,true);assert.equal(b.existed,true);
 const read=await readPropEvidence({ARCHIVE:bucket},'OFFICIAL_RESULT',a.id,{webCrypto:webcrypto});assert.equal(read.ok,true);
 const key=[...memory.keys()][0];memory.set(key,memory.get(key).replace('"actual":3','"actual":4'));
 assert.equal((await readPropEvidence({ARCHIVE:bucket},'OFFICIAL_RESULT',a.id,{webCrypto:webcrypto})).reason,'CONTENT_INTEGRITY_FAILED');
 assert.equal((await persistPropEvidence({ARCHIVE:bucket},data,{webCrypto:webcrypto})).reason,'EXISTING_CONTENT_CONFLICT');
});
test('missing binding and malformed identity fail closed',async()=>{
 assert.equal((await persistPropEvidence({},data,{webCrypto:webcrypto})).ok,false);
 assert.equal((await persistPropEvidence({ARCHIVE:bucket},{...data,sourceId:null},{webCrypto:webcrypto})).ok,false);
 assert.equal((await readPropEvidence({ARCHIVE:bucket},'OFFICIAL_RESULT','bad',{webCrypto:webcrypto})).ok,false);
});
