import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import Module from 'node:module';
const bundle=await build({entryPoints:['services/polymarket-us-stream/worker.mjs'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'test-durable-object',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare:workers',namespace:'test'}));builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env}}'}));}}]});
const compiled=new Module('/tmp/fbis-stream-test.cjs');compiled._compile(bundle.outputFiles[0].text,'/tmp/fbis-stream-test.cjs');
const {PolymarketMarketStream}=compiled.exports;
test('actual collector answers heartbeat without creating quote rows and reports disconnected health',()=>{
 const sent=[],alarms=[];const collector=new PolymarketMarketStream({storage:{async setAlarm(at){alarms.push(at)}}},{});
 collector.socket={readyState:WebSocket.OPEN,send(value){sent.push(JSON.parse(value))},close(){}};
 collector.onMessage({data:'{"heartbeat":{}}'});
 assert.deepEqual(sent,[{heartbeat:{}}]);assert.equal(collector.heartbeats,1);
 assert.equal(collector.parsed,0);assert.equal(collector.queue.size,0);assert.equal(collector.status().operational,true);
 collector.onMessage({data:'{"error":"subscription rejected","request_id":"test"}'});
 assert.equal(collector.status().operational,false);assert.equal(collector.status().connected,false);
 assert.equal(collector.lastError,'upstream-subscription-error');assert.equal(alarms.length,1);
});

test('legacy collector alarms retire without provider calls or deleting source evidence',async()=>{
 let removed=0,closed=0;const collector=new PolymarketMarketStream({id:{toString:()=> 'legacy'},storage:{async deleteAlarm(){removed++;}},waitUntil(){}},{PM_STREAM:{idFromName:()=>({toString:()=> 'canonical'})},DB:{prepare(){throw Error('legacy must not query source inventory')}}});
 collector.socket={close(){closed++;}};await collector.alarm();
 assert.equal(removed,1);assert.equal(closed,1);assert.equal(collector.status().retiredOwner,true);assert.equal(collector.lastError,'LEGACY_OWNER_RETIRED');
});
