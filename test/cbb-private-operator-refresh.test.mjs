import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshCbbOnce,buildFreshCbbResearch,readRecentCbbScheduleAsset} from '../functions/lib/cbbPrivateOperatorRefresh.js';
import {onRequestPost,onRequest} from '../deploy/board/functions/api/private/cbb/refresh/manual.js';
import {shouldAutoRefreshCbb,requestAutoCbbRefresh} from '../src/lib/privateCbbAuto.js';
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

test('owner board automatically attempts CBB only when current slate is missing or expiring',()=>{
 assert.equal(shouldAutoRefreshCbb({date,today:date,status:'NO_CBB_SNAPSHOT',now}),true);
 assert.equal(shouldAutoRefreshCbb({date,today:date,status:'PRIVATE_SIGN_IN_REQUIRED',now}),false);
 assert.equal(shouldAutoRefreshCbb({date,today:date,status:'PRIVATE_DATA_UNAVAILABLE',now}),false);
 assert.equal(shouldAutoRefreshCbb({date:'2026-11-03',today:date,status:'NO_CBB_SNAPSHOT',now}),false);
 assert.equal(shouldAutoRefreshCbb({date,today:date,status:'NO_CBB_SNAPSHOT',attempted:true,now}),false);
 const fresh={expiresAt:new Date(now+4*3600000).toISOString()};
 const aging={expiresAt:new Date(now+5*60000).toISOString()};
 assert.equal(shouldAutoRefreshCbb({date,today:date,packet:fresh,now}),false);
 assert.equal(shouldAutoRefreshCbb({date,today:date,packet:aging,now}),true);
});
test('automatic owner refresh is one same-origin authenticated POST, not a public GET',async()=>{
 let n=0;
 const response=await requestAutoCbbRefresh(date,{fetchFn:async(url,options)=>{
   n++;assert.equal(url,'/api/private/cbb/refresh/manual');
   assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');
   assert.equal(options.headers['X-FBIS-Manual-Refresh'],'1');
   assert.deepEqual(JSON.parse(options.body),{date});
   return new Response(JSON.stringify({state:'REFRESHED',primaryProjections:12}),{status:200});
 }});
 assert.equal(n,1);assert.equal(response.ok,true);assert.equal(response.primaryProjections,12);
});
test('CBB auto refresh exposes a safe state for rejected owner and does not retry',async()=>{
 let called=0;
 const result=await requestAutoCbbRefresh(date,{fetchFn:async()=>{called++;return new Response(JSON.stringify({state:'PRIVATE_AUTH_REQUIRED'}),{status:401});}});
 assert.equal(called,1);assert.equal(result.ok,false);assert.equal(result.state,'PRIVATE_AUTH_REQUIRED');
});

test('recent public CBB scoreboard from Pages serves verified schedule without new ESPN calls',async()=>{
 const capturedAt=new Date(now-12*60*1000).toISOString();
 const fixture={id:'401234567',date,sport:'cbb',start:new Date(now+4*3600*1000).toISOString(),
  status:'scheduled',source:'ESPN_SCOREBOARD',neutralSite:false,home:{espnId:'1',name:'Home'},away:{espnId:'2',name:'Away'}};
 const board={version:1,date,publicationMode:'SCHEDULE_AND_SCORES_ONLY',generatedAt:capturedAt,
  feeds:{cbb:{ok:true,source:'ESPN_SCOREBOARD'}},sources:[{sport:'cbb',ok:true},{sport:'cbb',ok:true}],games:[fixture]};
 const seen=[];
 const assets={fetch:async req=>{seen.push(req.url);return new Response(JSON.stringify(board),{status:200,headers:{'Content-Type':'application/json'}});}};
 const value=await readRecentCbbScheduleAsset(date,{assets,now});
 assert.equal(seen.length,1);assert.equal(value?.games?.length,1);assert.equal(value?.source,'VERIFIED_SAVED_ESPN_SCOREBOARD');
 assert.match(seen[0],/board-data\/2026-11-04\.json$/);
});
test('Pages schedule fallback rejects stale, incomplete, tampered or cross-date sources',async()=>{
 const fixture={id:'401234567',date,sport:'cbb',start:new Date(now+4*3600*1000).toISOString(),
  status:'scheduled',source:'ESPN_SCOREBOARD',neutralSite:false,home:{espnId:'1'},away:{espnId:'2'}};
 const sample={version:1,date,publicationMode:'SCHEDULE_AND_SCORES_ONLY',generatedAt:new Date(now-1000).toISOString(),
  feeds:{cbb:{ok:true,source:'ESPN_SCOREBOARD'}},sources:[{sport:'cbb',ok:true},{sport:'cbb',ok:true}],games:[fixture]};
 const verify=async b=>readRecentCbbScheduleAsset(date,{now,assets:{fetch:async()=>new Response(JSON.stringify(b),{status:200,headers:{'content-type':'application/json'}})}});
 assert.equal(await verify({...sample,generatedAt:new Date(now-4*3600*1000).toISOString()}),null);
 assert.equal(await verify({...sample,feeds:{cbb:{ok:false,source:'ESPN_SCOREBOARD'}}}),null);
 assert.equal(await verify({...sample,sources:[{sport:'cbb',ok:true}]}),null);
 assert.equal(await verify({...sample,games:[{...fixture,date:'2026-11-03'}]}),null);
 assert.equal(await verify({...sample,games:[{...fixture,home:{espnId:'bad'}}]}),null);
});
test('private CBB error response gives a safe stage on HTML or redirect block',async()=>{
 const {requestAutoCbbRefresh}=await import('../src/lib/privateCbbAuto.js');
 const blocked=await requestAutoCbbRefresh(date,{fetchFn:async()=>new Response('<html>not found</html>',{status:404,headers:{'Content-Type':'text/html'}})});
 assert.equal(blocked.state,'PRIVATE_REFRESH_ENDPOINT_NOT_FOUND');
 const denied=await requestAutoCbbRefresh(date,{fetchFn:async()=>new Response('<html>Access</html>',{status:403,headers:{'Content-Type':'text/html'}})});
 assert.equal(denied.state,'PRIVATE_SIGN_IN_REQUIRED');
 const errored=await requestAutoCbbRefresh(date,{fetchFn:async()=>{throw Error('redirect blocked');}});
 assert.equal(errored.state,'PRIVATE_ACCESS_REDIRECT_OR_CONNECTION_FAILED');
});
