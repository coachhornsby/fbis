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

test('enabled collector handles actual trades without adding BBO rows and bounds retention',()=>{
 const collector=new PolymarketMarketStream({storage:{async setAlarm(){}}},{POLYMARKET_FLOW_CAPTURE:'true'});
 collector.subscribed.set('team-a-team-b',{sport:'nfl',canonical_event_id:'game',side:'Team A',market_family:'moneyline',period:'full_game'});
 const event=i=>({data:JSON.stringify({trade:{marketSlug:'team-a-team-b',price:{value:'.55',currency:'USD'},quantity:{value:'.5',currency:'USD'},tradeTime:new Date(1792047600000+i).toISOString(),maker:{side:'ORDER_SIDE_SELL',intent:'ORDER_INTENT_SELL_LONG'},taker:{side:'ORDER_SIDE_BUY',intent:'ORDER_INTENT_BUY_LONG'}}})});
 for(let i=0;i<300;i++)collector.onMessage(event(i));
 assert.equal(collector.tradeReceived,300);assert.equal(collector.tradeClassified,300);
 assert.equal(collector.flow.get('team-a-team-b').trades.length,256);
 assert.equal(collector.flow.get('team-a-team-b').truncated,true);
 assert.equal(collector.queue.size,0);assert.equal(collector.parsed,0);
 collector.onMessage(event(299));assert.equal(collector.flow.get('team-a-team-b').trades.length,256);
});

test('capture is disabled by default and cannot start storing trade events',()=>{
 const collector=new PolymarketMarketStream({storage:{async setAlarm(){}}},{});
 collector.onMessage({data:JSON.stringify({trade:{marketSlug:'a-b'}})});
 assert.equal(collector.flowEnabled,false);assert.equal(collector.flow.size,0);assert.equal(collector.tradeReceived,0);
});
