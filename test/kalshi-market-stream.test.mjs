import test from 'node:test';import assert from 'node:assert/strict';
import {runKalshiMarketSession,KALSHI_STREAM_KEY} from '../services/kalshi-public-collector/marketSession.mjs';
import {onRequestPost,onRequestGet} from '../deploy/board/functions/api/kalshi-market-stream-sign.js';
const now=Date.now(),ticker='KXNBAGAME-26NOV06TEST-TEST';
function setup({fresh=true,frame={type:'ticker',msg:{market_ticker:ticker,yes_bid_dollars:'0.45',yes_ask_dollars:'0.49'}},status=101}={}){
 const writes=[],calls=[],spends=[],listeners=new Map();let closed=false;
 const socket={accept(){},addEventListener:(t,fn)=>listeners.set(t,fn),removeEventListener:t=>listeners.delete(t),close(){closed=true;},send(s){const sub=JSON.parse(s);assert.deepEqual(sub.params.channels,['ticker']);assert.deepEqual(sub.params.market_tickers,[ticker]);queueMicrotask(()=>{listeners.get('message')?.({data:JSON.stringify(frame)});listeners.get('close')?.();});}};
 return {writes,calls,spends,closed:()=>closed,env:{FBIS_KALSHI_RELAY_TOKEN:'T'.repeat(64),ARCHIVE:{get:async key=>key.endsWith('/nba.json')?{json:async()=>({ok:true,sport:'nba',capturedAt:new Date(now-(fresh?0:1800001)).toISOString(),records:[{sport:'nba',ticker,fetchedAt:new Date(now).toISOString()}]})}:null,put:async(k,v)=>writes.push([k,JSON.parse(v)])},FBIS_JOB_FETCH:async url=>{calls.push(url);return Response.json({ok:true,path:'/trade-api/ws/v2',headers:{'KALSHI-ACCESS-TIMESTAMP':String(now),'KALSHI-ACCESS-KEY':'test','KALSHI-ACCESS-SIGNATURE':'test'}});}},lease:{expiresAtMs:now+120000,live(){},spend:u=>spends.push(u)},fetchImpl:async(url,options)=>{calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');return {status,webSocket:status===101?socket:null,body:null};}};
}
test('market WS requires fresh tickers, uses fixed signer and read channel, stores observed quotes',async()=>{
 const s=setup(),r=await runKalshiMarketSession(s.env,s.lease,{fetchImpl:s.fetchImpl,now:()=>now});
 assert.equal(r.ok,true);assert.equal(r.quotes,1);assert.equal(s.closed(),true);assert.equal(s.writes[0][0],KALSHI_STREAM_KEY);assert.equal(s.writes[0][1].quotes[0].yesAsk,.49);assert.equal(s.writes[0][1].quotes[0].sourceObservedAt,null);assert.equal(s.writes[0][1].canAuthorizeWager,false);assert.equal(s.spends.find(x=>x.doDurationMs)?.doDurationMs,30000);
});
test('stale source performs no network or writes; rejected handshake never publishes',async()=>{
 const s=setup({fresh:false});assert.equal((await runKalshiMarketSession(s.env,s.lease,{fetchImpl:s.fetchImpl,now:()=>now})).code,'NO_FRESH_KALSHI_TICKERS');assert.equal(s.calls.length,0);assert.equal(s.writes.length,0);
 const t=setup({status:403});await assert.rejects(()=>runKalshiMarketSession(t.env,t.lease,{fetchImpl:t.fetchImpl,now:()=>now}),/HANDSHAKE_403/);assert.equal(t.writes.length,0);
});
test('unsubscribed ticker is excluded and provider error is reported',async()=>{
 for(const frame of [{type:'ticker',msg:{market_ticker:'OTHER',yes_bid_dollars:'0.5'}},{type:'error',msg:{code:9}}]){const s=setup({frame}),r=await runKalshiMarketSession(s.env,s.lease,{fetchImpl:s.fetchImpl,now:()=>now});assert.equal(r.quotes,0);if(frame.type==='error')assert.equal(r.stopReason,'PROVIDER_SUBSCRIPTION_ERROR');}
});
test('public broker rejects missing token and budget pause without key access',async()=>{
 assert.equal((await onRequestGet()).status,405);
 const req=auth=>new Request('https://local',{method:'POST',headers:auth?{'x-fbis-kalshi-relay-token':'T'.repeat(64)}:{}});
 assert.equal((await onRequestPost({request:req(false),env:{}})).status,403);
 const env={CLOUDFLARE_ACCOUNT_ID:'test',FBIS_KALSHI_RELAY_TOKEN:'T'.repeat(64),FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async()=>({allowed:false,reason:'PAUSED'})})}};
 const res=await onRequestPost({request:req(true),env});assert.equal(res.status,503);assert.deepEqual(await res.json(),{ok:false,code:'ACCOUNT_BUDGET_STOP'});
});
