import test from 'node:test';import assert from 'node:assert/strict';import {handleNflFeatureOperation} from '../workers/nfl-feature-operations-route.mjs';
const token='offline-test-token'.repeat(3),base={ORCH_CONTROL_TOKEN:token,FBIS_NFL_FEATURE_OPERATIONS_ENABLED:'true',FBIS_NFL_RUNTIME_CPU_MS:'100'};
const request=(path='/api/nfl/features/publish',body)=>new Request('https://private.invalid'+path,{method:'POST',headers:{authorization:`Bearer ${token}`},...(body===undefined?{}:{body})});
test('NFL operations disabled without explicit flag and do not touch storage',async()=>{assert.equal((await handleNflFeatureOperation(request(),{})).status,404);assert.equal(await handleNflFeatureOperation(request('/api/cfb/features/publish'),base),null);});
test('no auth fallback, CPU declaration required, strict requests',async()=>{assert.equal((await handleNflFeatureOperation(new Request('https://private.invalid/api/nfl/features/inspect'),base)).status,400);assert.equal((await handleNflFeatureOperation(request(),{...base,FBIS_NFL_RUNTIME_CPU_MS:'10'})).status,503);assert.equal((await handleNflFeatureOperation(request('/api/nfl/features/inspect?key=cfb'),base)).status,400);assert.equal((await handleNflFeatureOperation(request('/api/nfl/features/inspect','{}'),base)).status,503);});
test('unapproved exact publication and unexpected fields cannot request admission',async()=>{let called=false;const env={...base,FBIS_ACCOUNT_BUDGET:{getByName(){called=true;throw Error('no');}}};assert.equal((await handleNflFeatureOperation(request(undefined,JSON.stringify({snapshotText:'{}',receipt:{},season:2026})),env)).status,403);assert.equal((await handleNflFeatureOperation(request(undefined,JSON.stringify({snapshotText:'{}',receipt:{},season:2026,now:0})),env)).status,400);assert.equal(called,false);});
test('oversized chunked publication is cancelled before admission',async()=>{
 let cancelled=false,calls=0;const env={...base,FBIS_ACCOUNT_BUDGET:{getByName(){calls++;throw Error('no');}}};
 const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(9*1024*1024+1));},cancel(){cancelled=true;}});
 const r=new Request('https://private.invalid/api/nfl/features/publish',{method:'POST',headers:{authorization:`Bearer ${token}`},body,duplex:'half'});
 assert.equal((await handleNflFeatureOperation(r,env)).status,503);assert.equal(cancelled,true);assert.equal(calls,0);
});
test('idle body deadline returns despite stalled cancellation',async()=>{
 let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}});
 const r=new Request('https://private.invalid/api/nfl/features/publish',{method:'POST',headers:{authorization:`Bearer ${token}`},body,duplex:'half'}),start=Date.now();
 assert.equal((await handleNflFeatureOperation(r,base)).status,503);assert.equal(cancelled,true);assert.ok(Date.now()-start<6500);
});
