import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestPost as kalshi,onRequestGet as kalshiGet} from '../deploy/board/functions/api/kalshi-collector-internal.js';
import {onRequestPost as poly,onRequestGet as polyGet} from '../deploy/board/functions/api/polymarket-stream-sign.js';
const token='test-only-'.repeat(6);
test('restored relay routes reject unauthenticated calls without reading archive',async()=>{
 let touched=0;const archive={get(){touched++;throw Error('unexpected read');}};
 const k=await kalshi({request:new Request('https://example.com/api/kalshi-collector-internal',{method:'POST'}),env:{FBIS_PRIVATE_CBB:archive},webCrypto:webcrypto});
 const p=await poly({request:new Request('https://example.com/api/polymarket-stream-sign',{method:'POST'}),env:{}});
 assert.equal(k.status,403);assert.equal(p.status,403);assert.equal(touched,0);
 assert.equal((await kalshiGet()).status,405);assert.equal((await polyGet()).status,405);
});
test('valid service token cannot bypass paused account admission or expose signing headers',async()=>{
 const admission={getByName:()=>({reserve:async()=>({allowed:false,reason:'PAUSED'})})};
 const env={CLOUDFLARE_ACCOUNT_ID:'test-account',FBIS_ACCOUNT_BUDGET:admission,
 FBIS_KALSHI_RELAY_TOKEN:token,POLYMARKET_STREAM_PROXY_TOKEN:token};
 const k=await kalshi({request:new Request('https://example.com/api/kalshi-collector-internal?scope=markets&sport=nba',{
 method:'POST',headers:{'x-fbis-kalshi-relay-token':token}}),env,webCrypto:webcrypto});
 const p=await poly({request:new Request('https://example.com/api/polymarket-stream-sign',{
 method:'POST',headers:{'x-fbis-stream-token':token}}),env});
 assert.equal(k.status,503);assert.equal(p.status,503);
 assert.equal((await k.json()).code,'ACCOUNT_BUDGET_STOP');
 const body=await p.json();assert.equal(body.error,'account-budget-stop');assert.equal(body.headers,undefined);
});
