import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshCbbOnce,buildFreshCbbResearch} from '../functions/lib/cbbPrivateOperatorRefresh.js';
import {onRequestPost,onRequest} from '../deploy/board/functions/api/private/cbb/refresh/manual.js';
const date='2026-11-04',now=Date.parse('2026-11-04T16:15:00Z');
function storage(){
 const db=new Map();const touches={writes:[],reads:[]};
 return {db,touches,
  async get(key){touches.reads.push(key);const value=db.get(key);return value===undefined?null:{size:value.length,text:async()=>value};},
  async put(key,body,opts={}){touches.writes.push(key);if(opts.onlyIf?.etagDoesNotMatch==='*'&&db.has(key))return null;db.set(key,String(body));return {key,etag:'etag'};}
 };
}
const sample=()=>({packet:{version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',expiresAt:'2026-11-04T23:15:00Z',events:[{date,eventId:'401234567',start:'2026-11-04T23:30:00Z',homeId:'cbb-1',awayId:'cbb-2',neutralSite:false,primary:{home:81,away:70,margin:11,total:151}}],summary:{primaryProjections:1,torvikComparisons:0,currentCbbdConfirmations:0}},evidence:{date,generatedAt:new Date(now).toISOString(),canAuthorizeWager:false}});
test('owner one-shot writes only private R2 projections/receipts/budget, never D1',async()=>{
 const bucket=storage();let calls=0;
 const res=await refreshCbbOnce({bucket,date,key:'test-key',now,builder:async()=>{calls++;return sample();}});
 assert.equal(res.state,'REFRESHED');assert.equal(res.status,200);assert.equal(calls,1);
 assert.deepEqual(bucket.touches.writes.sort(),['private/cbb/projections/'+date+'.json','private/cbb/refresh-budget/'+date+'/attempt-1.json','private/cbb/refresh-receipts/'+date+'.json'].sort());
 assert.equal(JSON.parse(bucket.db.get('private/cbb/projections/'+date+'.json')).summary.primaryProjections,1);
});
test('unexpired R2 snapshot serves without any additional paid fetch',async()=>{
 const bucket=storage();bucket.db.set('private/cbb/projections/'+date+'.json',JSON.stringify(sample().packet));let calls=0;
 const res=await refreshCbbOnce({bucket,date,key:'test-key',now,builder:async()=>{calls++;return sample();}});
 assert.equal(res.state,'ALREADY_FRESH');assert.equal(res.providerCalls,0);assert.equal(calls,0);assert.equal(bucket.touches.writes.length,0);
});
test('wrong day and absent credential fail before R2 writes',async()=>{
 const bucket=storage();
 const invalid=await refreshCbbOnce({bucket,date:'2026-11-03',key:'test-key',now,builder:async()=>{throw Error('never');}});
 assert.equal(invalid.status,400);
 const missing=await refreshCbbOnce({bucket,date,key:'',now,builder:async()=>{throw Error('never');}});
 assert.equal(missing.status,503);assert.equal(bucket.touches.writes.length,0);
});
test('manual refresh requires same-origin explicit owner action before authentication',async()=>{
 const req=new Request('https://fbis-myz.pages.dev/api/private/cbb/refresh/manual',{method:'POST',headers:{Origin:'https://other.example','X-FBIS-Manual-Refresh':'1','Content-Type':'application/json'},body:JSON.stringify({date})});
 const res=await onRequestPost({request:req,env:{}});
 assert.equal(res.status,403);
 const same=new Request(req.url,{method:'POST',headers:{Origin:'https://fbis-myz.pages.dev','X-FBIS-Manual-Refresh':'1','Content-Type':'application/json'},body:JSON.stringify({date})});
 const denied=await onRequestPost({request:same,env:{}});
 assert.equal(denied.status,401);
 const get=await onRequest();assert.equal(get.status,405);
});
test('replay guard caps licensed attempts to two per day',async()=>{
 const bucket=storage(),past=now-7*60*60*1000;
 for(const slot of [1,2])bucket.db.set('private/cbb/refresh-budget/'+date+'/attempt-'+slot+'.json',JSON.stringify({date,slot,startedAt:new Date(past).toISOString()}));
 let called=false;
 const res=await refreshCbbOnce({bucket,date,key:'key',now,builder:async()=>{called=true;return sample();}});
 assert.equal(res.state,'DAILY_REFRESH_CAP');assert.equal(res.status,429);assert.equal(called,false);
});
test('failed provider fetch records failure but no forecast and cannot silently retry',async()=>{
 const bucket=storage(),res=await refreshCbbOnce({bucket,date,key:'key',now,builder:async()=>{throw Error('KENPOM_HTTP_403');}});
 assert.equal(res.state,'REFRESH_FAILED');assert.equal(res.status,503);
 assert.equal(bucket.db.has('private/cbb/projections/'+date+'.json'),false);
 assert.equal(JSON.parse(bucket.db.get('private/cbb/refresh-receipts/'+date+'.json')).reason,'KENPOM_HTTP_403');
 const retry=await refreshCbbOnce({bucket,date,key:'key',now:now+1000,builder:async()=>sample()});
 assert.equal(retry.state,'REFRESH_PAUSED');assert.equal(retry.status,429);
});
test('one-shot source builder refuses missing key without network requests',async()=>{
 let called=0;
 await assert.rejects(buildFreshCbbResearch(date,{key:'',now,fetchFn:async()=>{called++;throw Error('network');}}),/KENPOM_KEY_NOT_CONFIGURED/);
 assert.equal(called,0);
});
