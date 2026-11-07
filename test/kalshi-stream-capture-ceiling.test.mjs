import test from 'node:test';
import assert from 'node:assert/strict';
import {runKalshiMarketSession} from '../services/kalshi-public-collector/marketSession.mjs';
import {createExecutionLease} from '../services/account-budget/execution.mjs';
const ticker='KXNBAGAME-26NOV06TEST-TEST';
async function run({messages=128,bytes=1048576,frames=140,expire=false,sourceTime=null}={}){
 const at=Date.now();let clock=at,closed=false;const listeners=new Map(),writes=[];
 const lease=createExecutionLease({allowed:true,expiresAtMs:at+110000,maxUnits:{requests:1,doDurationMs:30000,wsSends:1,wsSendBytes:16384,wsMessages:messages,wsBytes:bytes,r2Writes:1,r2Bytes:1048576}},{now:()=>clock});
 const frame=JSON.stringify({type:'ticker',msg:{market_ticker:ticker,ts_ms:sourceTime,yes_bid_dollars:'0.45',yes_ask_dollars:'0.49'}});
 const socket={accept(){},addEventListener:(t,fn)=>listeners.set(t,fn),removeEventListener:t=>listeners.delete(t),close(){closed=true;},send(){queueMicrotask(()=>{if(expire)clock=at+111000;for(let i=0;i<frames;i++)listeners.get('message')?.({data:frame});listeners.get('close')?.();});}};
 const env={FBIS_KALSHI_RELAY_TOKEN:'x'.repeat(64),ARCHIVE:{get:async key=>key.endsWith('/nba.json')?{json:async()=>({ok:true,sport:'nba',capturedAt:new Date(at).toISOString(),records:[{sport:'nba',ticker,fetchedAt:new Date(at).toISOString()}]})}:null,put:async(k,v)=>{lease.spend({r2Writes:1,r2Bytes:new TextEncoder().encode(v).length});writes.push(JSON.parse(v));}},FBIS_JOB_FETCH:async()=>Response.json({ok:true,path:'/trade-api/ws/v2',headers:{'KALSHI-ACCESS-TIMESTAMP':String(at),'KALSHI-ACCESS-KEY':'test','KALSHI-ACCESS-SIGNATURE':'test'}})};
 const result=await runKalshiMarketSession(env,lease,{now:()=>clock,fetchImpl:async()=>({status:101,webSocket:socket})});return {result,writes,lease:lease.snapshot(),closed,frameBytes:new TextEncoder().encode(frame).length};
}
test('busy stream closes at 128 admitted frames and persists bounded evidence with a live lease',async()=>{const r=await run();assert.equal(r.result.messages,128);assert.equal(r.result.stopReason,'CAPTURE_ALLOWANCE_REACHED');assert.equal(r.writes.length,1);assert.equal(r.writes[0].quotes.length,1);assert.equal(r.writes[0].canAuthorizeWager,false);assert.equal(r.lease.closed,false);assert.equal(r.lease.used.wsMessages,128);assert.equal(r.lease.used.r2Writes,1);assert.equal(r.closed,true);});
test('smaller account allowance is respected and does not grow to hardcoded cap',async()=>{const r=await run({messages:2});assert.equal(r.result.messages,2);assert.equal(r.lease.used.wsMessages,2);assert.equal(r.writes.length,1);});
test('byte ceiling stops before an oversized next charge without invalidating lease',async()=>{const r=await run({bytes:200});assert.equal(r.result.messages,1);assert.ok(r.lease.used.wsBytes<=200);assert.equal(r.result.stopReason,'CAPTURE_ALLOWANCE_REACHED');assert.equal(r.writes.length,1);});
test('actual expired lease still cannot publish',async()=>{await assert.rejects(()=>run({expire:true}),/JOB_LEASE_EXPIRED_OR_STOPPED/);});

test("provider update survives capture without changing authority",async()=>{const sourceTime=Date.now()-10000;const r=await run({sourceTime});assert.equal(r.writes[0].quotes[0].sourceObservedAt,new Date(sourceTime).toISOString());assert.equal(r.writes[0].canAuthorizeWager,false);assert.equal(r.result.messages,128);});
test("missing provider update remains null",async()=>{const r=await run();assert.equal(r.writes[0].quotes[0].sourceObservedAt,null);});
