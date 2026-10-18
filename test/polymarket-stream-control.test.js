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

test('full inventory uses bounded socket subscriptions; one rejected shard cannot report complete',async t=>{
 const sockets=[];const alarms=[];const realSetTimeout=globalThis.setTimeout;
 let collector;
 t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>ms===250?(queueMicrotask(()=>fn(...args)),0):realSetTimeout(fn,ms,...args));
 t.mock.method(globalThis,'fetch',async url=>{
  if(String(url).includes('stream-sign'))return {ok:true,json:async()=>({ok:true,path:'/v1/ws/markets',headers:{'X-PM-Timestamp':String(Date.now()),'X-PM-Access-Key':'test','X-PM-Signature':'test'}})};
  const handlers={},sent=[];const socket={readyState:WebSocket.OPEN,accept(){},addEventListener(type,fn){handlers[type]=fn},send(raw){sent.push(JSON.parse(raw));if(sockets.length===1)collector.lastError='d1-bbo-persist-error';},close(){this.readyState=WebSocket.CLOSED},handlers,sent};
  sockets.push(socket);return {status:101,webSocket:socket};
 });
 collector=new PolymarketMarketStream({storage:{async setAlarm(at){alarms.push(at)}}},{});
 collector.candidates=async()=>Array.from({length:1201},(_,i)=>({source_market_id:'market-'+i,sport:'nfl'}));
 collector.lastCandidateDiagnostics={bySport:{nfl:{eligible:1201,assigned:1201}},eligibleCount:1201};
 await collector.connect();
 assert.equal(sockets.length,7);assert.equal(collector.status().connected,true);
 assert.equal(collector.status().subscriptions,1201);assert.equal(collector.status().activeConnections,7);
 assert.equal(collector.status().sportCoverage.nfl.subscribed,1201);
 assert.equal(collector.status().lastError,'d1-bbo-persist-error');
 const books=sockets.flatMap(s=>s.sent.filter(x=>x.subscribe.subscription_type==='SUBSCRIPTION_TYPE_MARKET_DATA').flatMap(x=>x.subscribe.market_slugs));
 assert.equal(new Set(books).size,1201);assert.equal(books.length,1201);
 for(const socket of sockets){assert.ok(socket.sent.length<=8);assert.ok(socket.sent.every(x=>x.subscribe.market_slugs.length<=50));}
 sockets[0].handlers.message({data:'{"heartbeat":{}}'});
 assert.deepEqual(sockets[0].sent.at(-1),{heartbeat:{}});
 sockets[0].handlers.message({data:'{"error":"max subscriptions per connection reached"}'});
 assert.equal(collector.status().connected,false);assert.equal(collector.status().operational,false);
 assert.equal(collector.status().subscriptions,1001);assert.equal(collector.status().activeConnections,6);
 assert.equal(collector.status().sportCoverage.nfl.uncovered,200);
 assert.equal(collector.status().sportCoverage.nfl.status,'PARTIAL');
 collector.closeSockets('test-complete');assert.equal(collector.status().subscriptions,0);
});
