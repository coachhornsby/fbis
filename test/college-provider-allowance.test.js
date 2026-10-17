import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/college-provider-allowance.js';
test('allowance audit rejects unauthenticated requests before network',async()=>{
 const r=await onRequestPost({request:new Request('https://example.test'),env:{HARVEST_SECRET:'operator-secret'}});
 assert.equal(r.status,403);
});
test('allowance audit reports zero truthfully and never clears exhaustion',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url)=>{assert.equal(url,'https://api.collegefootballdata.com/info');return Response.json({remainingCalls:0,monthlyLimit:75000,usedCalls:75000,sharedPool:true});};
 try{
 const r=await onRequestPost({request:new Request('https://example.test',{headers:{'x-harvest-secret':'operator-secret'}}),env:{HARVEST_SECRET:'operator-secret',CFBD_API_KEY:'private-provider-secret'}});
 const body=await r.json();assert.equal(r.status,200);assert.equal(body.remainingCalls,0);assert.equal(body.allowanceVerified,true);assert.equal(body.quotaAcknowledged,false);assert.equal(body.collectionStarted,false);assert.ok(!JSON.stringify(body).includes('private-provider-secret'));
 }finally{globalThis.fetch=original;}
});
test('null account response cannot authorize collection',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json(null);
 try{const r=await onRequestPost({request:new Request('https://example.test',{headers:{'x-harvest-secret':'operator-secret'}}),env:{HARVEST_SECRET:'operator-secret',CFBD_API_KEY:'private'}});assert.equal(r.status,502);}finally{globalThis.fetch=original;}
});
