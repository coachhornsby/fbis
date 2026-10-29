import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../services/account-budget/package.json',import.meta.url));
const {Miniflare}=require(process.env.FBIS_MINIFLARE_MODULE||'miniflare');
const {build}=require(process.env.FBIS_ESBUILD_MODULE||'esbuild');
const root=fileURLToPath(new URL('../',import.meta.url));
const built=await build({stdin:{contents:`import collector from './services/polymarket-tennis-collector/index.js';export {AccountBudget} from './services/account-budget/worker.mjs';export default {async fetch(request,env){if(new URL(request.url).pathname==='/run'){const pending=[];await collector.scheduled({},env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);return new Response('done');}return collector.fetch(request,env);}};`,resolveDir:root},bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],write:false});
const job='services/polymarket-tennis-collector/index.js';
function policy(enabled,requests){const now=Date.now();const collect={requests,responseBytes:1024,r2Reads:0,r2Writes:2,r2Lists:0,r2Bytes:1048576,d1Queries:0,reads:0,writes:0};const health={requests:0,responseBytes:0,r2Reads:1,r2Writes:0,r2Lists:0,r2Bytes:65536,d1Queries:0,reads:0,writes:0};return {enabled,startMs:now-1000,endMs:now+3600000,measuredAtMs:now,expiresAtMs:now+900000,committedMicroUsd:0,unitCeilings:{requests:10,responseBytes:10000,r2Reads:10,r2Writes:10,r2Lists:0,r2Bytes:2097152,d1Queries:0,reads:0,writes:0},jobs:{[job]:{worstCaseMicroUsd:1000,maxUnits:collect},[job+':health']:{worstCaseMicroUsd:1000,maxUnits:health}}};}
async function setup(enabled,requests){let calls=0;const mf=new Miniflare({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-07-01',durableObjects:{FBIS_ACCOUNT_BUDGET:{className:'AccountBudget',useSQLite:true}},r2Buckets:{ARCHIVE:'archive'},bindings:{CLOUDFLARE_ACCOUNT_ID:'test',FBIS_ACCOUNT_BUDGET_POLICY:JSON.stringify(policy(enabled,requests))},outboundService:async request=>{calls++;assert.equal(new URL(request.url).origin,'https://gateway.polymarket.us');return Response.json({events:[]});}});return{mf,calls:()=>calls};}
test('paused policy performs no provider request or R2 write in the real Worker runtime',async()=>{
 const {mf,calls}=await setup(false,2);try{await mf.dispatchFetch('https://local/run');assert.equal(calls(),0);const r=await mf.dispatchFetch('https://local/health');assert.equal(r.status,503);assert.equal((await (await mf.getR2Bucket('ARCHIVE')).list()).objects.length,0);}finally{await mf.dispose();}
});
test('admitted collector and health reader use real R2 and preserve research-only status',async()=>{
 const {mf,calls}=await setup(true,2);try{await mf.dispatchFetch('https://local/run');assert.equal(calls(),2);const objects=(await (await mf.getR2Bucket('ARCHIVE')).list()).objects;assert.equal(objects.length,1);const r=await mf.dispatchFetch('https://local/health');assert.equal(r.status,200);const body=await r.json();assert.equal(body.canAuthorizeWager,false);assert.equal(body.readOnly,true);}finally{await mf.dispose();}
});
test('a smaller request allowance stops the second tour before network IO',async()=>{
 const {mf,calls}=await setup(true,1);try{await mf.dispatchFetch('https://local/run');assert.equal(calls(),1);assert.equal((await (await mf.getR2Bucket('ARCHIVE')).list()).objects.length,0);}finally{await mf.dispose();}
});
