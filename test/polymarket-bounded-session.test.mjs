import test from 'node:test';import assert from 'node:assert/strict';
import {createExecutionLease,executionEnv} from '../services/account-budget/execution.mjs';
import {runBoundedStream,validateStreamRoster,STREAM_ROSTER_KEY,STREAM_SNAPSHOT_KEY,STREAM_STATUS_KEY} from '../services/polymarket-us-stream/boundedSession.mjs';
import {CERTIFIED_EXECUTION_JOBS,POLY_STREAM_JOB as JOB} from '../services/account-budget/executionJobs.mjs';
const at=Date.now();
const row=(slug='contract-1',sport='nfl')=>({source_market_id:slug,sport,canonical_event_id:'fixture-1',market_family:'moneyline',event_start_time:new Date(at+60000).toISOString(),collected_at:new Date(at).toISOString()});
const manifest=(rows=[row()])=>({version:2,source:'Polymarket US',capturedAt:new Date(at).toISOString(),expiresAt:new Date(at+600000).toISOString(),roster:rows});
function setup({units={},roster=manifest(),brokerStatus=200}={}){
 let clock=at,reads=0,puts=0,requests=0,cancels=0,sendCount=0,timer;
 const listeners=new Map();const socket={accept(){},addEventListener(k,fn){listeners.set(k,fn);},removeEventListener(k){listeners.delete(k);},close(){cancels++;},send(){sendCount++;},emit(data){listeners.get('message')?.({data});},end(){listeners.get('close')?.({});}};
 const values=new Map([[STREAM_ROSTER_KEY,JSON.stringify(roster)]]);
 const bucket={head(){},async get(key){reads++;const value=values.get(key);return value?{size:Buffer.byteLength(value),body:new Response(value).body}:null;},async put(key,value){puts++;values.set(key,value);}};
 const lease=createExecutionLease({allowed:true,expiresAtMs:at+120000,maxUnits:{...CERTIFIED_EXECUTION_JOBS[JOB].units,...units}},{now:()=>clock});
 const fetchImpl=async url=>{requests++;if(String(url).includes('/polymarket-stream-sign'))return Response.json({ok:true,path:'/v1/ws/markets',headers:{'X-PM-Timestamp':String(at),'X-PM-Access-Key':'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','X-PM-Signature':'A'.repeat(86)+'=='}},{status:brokerStatus});return {status:101,webSocket:socket};};
 const env=executionEnv({ARCHIVE:bucket,FBIS_STREAM_PROXY_TOKEN:'t'.repeat(64)},lease,{fetchImpl,network:{origin:'https://fbis-myz.pages.dev',path:'/api/polymarket-stream-sign',method:'POST'}});
 const run=()=>runBoundedStream(env,lease,{fetchImpl,now:()=>clock,setTimer:fn=>{timer=fn;return 1;},clearTimer:()=>{}});
 return {run,socket,lease,values,stats:()=>({reads,puts,requests,cancels,sendCount}),deadline(){clock=at+20000;timer();},expire(){clock=at+120000;},async ready(){for(let i=0;i<20&&!sendCount;i++)await new Promise(r=>setImmediate(r));assert.equal(sendCount,1);}};
}
const quote=(slug='contract-1')=>JSON.stringify({market_data_lite:{market_slug:slug,best_bid:'0.45',best_ask:'0.5'}});
test('roster accepts every sport but rejects stale, duplicate, oversized or invalid entries',()=>{
 const sports=['nfl','cfb','cbb','nba','wnba','mlb','nhl','soccer','tennis','npb','kbo'];assert.equal(validateStreamRoster(manifest(sports.map((s,i)=>row('slug-'+i,s))),at).length,11);
 for(const m of [manifest([row(),row()]),manifest(Array.from({length:51},(_,i)=>row('slug-'+i))),{...manifest(),expiresAt:new Date(at-1).toISOString()},manifest([row('bad/slugs')]),manifest([row('slug','other')]),{...manifest(),capturedAt:new Date(at+1).toISOString()}])assert.throws(()=>validateStreamRoster(m,at));
});
test('finite session subscribes once, ignores unknown contracts, and saves research-only R2 output after close',async()=>{
 const x=setup();const run=x.run();await x.ready();x.socket.emit(quote('outside-roster'));x.socket.emit(quote());x.socket.end();const receipt=await run;
 assert.equal(receipt.quotes,1);assert.equal(receipt.continuous,false);assert.equal(receipt.canAuthorizeWager,false);assert.equal(x.stats().requests,2);assert.equal(x.stats().puts,2);assert.equal(x.stats().sendCount,1);assert.ok(x.stats().cancels>=1);const snapshot=JSON.parse(x.values.get(STREAM_SNAPSHOT_KEY));assert.equal(snapshot.quotes[0].quoteKind,'DISPLAY_REFERENCE_NOT_EXECUTABLE');assert.equal(snapshot.complete,false);assert.equal(snapshot.quotes[0].sourceObservedAt,null);assert.equal(snapshot.quotes[0].receivedAt,new Date(at).toISOString());
 x.socket.emit(quote());assert.equal(x.stats().puts,2);assert.equal(x.stats().requests,2);
});
test('message allowance stops the session and prevents later writes or reconnects',async()=>{const x=setup({units:{wsMessages:1}}),run=x.run();await x.ready();x.socket.emit(quote());x.socket.emit(quote());await assert.rejects(()=>run,/STOPPED/);x.socket.emit(quote());assert.equal(x.stats().requests,2);assert.equal(x.stats().puts,0);});
test('heartbeat output and received bytes consume their allowances before IO',async()=>{for(const units of [{wsBytes:1},{wsSends:1},{wsSendBytes:1}]){const x=setup({units}),run=x.run();if(units.wsSendBytes){await assert.rejects(()=>run,/UNIT_LIMIT/);}else{await x.ready();x.socket.emit(JSON.stringify({heartbeat:{}}));await assert.rejects(()=>run,/STOPPED/);}assert.equal(x.stats().puts,0);assert.ok(x.stats().sendCount<=1);}});
test('deadline closes a quiet socket without reconnecting and records partial coverage',async()=>{const x=setup(),run=x.run();await x.ready();x.deadline();const receipt=await run;assert.equal(receipt.stopReason,'SESSION_DEADLINE');assert.equal(receipt.quotes,0);assert.equal(x.stats().requests,2);assert.equal(x.stats().puts,2);assert.ok(x.values.has(STREAM_STATUS_KEY));});
test('expired leases close callbacks and prohibit final publication',async()=>{const x=setup(),run=x.run();await x.ready();x.expire();x.socket.emit(quote());await assert.rejects(()=>run,/EXPIRED/);assert.equal(x.stats().puts,0);});
test('bad or oversized rosters stop before signing and handshake; failed signing never downgrades',async()=>{for(const options of [{roster:{...manifest(),version:1}},{units:{r2Bytes:1}},{brokerStatus:503},{units:{doDurationMs:0}}]){const x=setup(options);await assert.rejects(()=>x.run());assert.equal(x.stats().puts,0);assert.ok(x.stats().requests<=1);}});
test('binary and oversized frames close without parsing or fabricating quotes',async()=>{for(const frame of [new ArrayBuffer(2),'x'.repeat(65537)]){const x=setup(),run=x.run();await x.ready();x.socket.emit(frame);const receipt=await run;assert.equal(receipt.quotes,0);assert.equal(receipt.stopReason,'MESSAGE_OR_EXECUTION_LIMIT');}});
