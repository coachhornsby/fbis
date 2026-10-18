import test from 'node:test';
import assert from 'node:assert/strict';
import {
 reservePinnoddsRun,capturePinnoddsSnapshot,requireProjectedFreeScope,
 verifyPinnoddsFreeTrial,PINNODDS_TRIAL_REST_COST_USD,PINNODDS_TRIAL_DOCUMENTED_LIMITS,
 PINNODDS_CAPTURE_REQUESTS
} from '../workers/pinnodds-governed-capture.mjs';

const now=new Date('2026-10-16T12:00:00Z');
function archive(){
 const map=new Map();let version=0;
 return {map,
  async get(key){const v=map.get(key);return v?{etag:v.etag,async json(){return JSON.parse(v.value);}}:null;},
  async put(key,value,options={}){const prev=map.get(key);
   if((options.onlyIf?.etagDoesNotMatch==='*'&&prev)||
      (options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==prev?.etag))return null;
   const v={etag:'version-'+(++version),value};map.set(key,v);return v;}
 };
}
const accountFetch=(usage=16,status='active')=>async(url,options)=>{
 assert.equal(String(url),'https://mcp.pinnodds.com/mcp');
 const body=JSON.parse(options.body);
 if(body.method==='notifications/initialized')return new Response(null,{status:202});
 const result=body.method==='initialize'?{}:
  {structuredContent:{status,usage_today:usage,plan:{id:'trial',limits:{perDay:100,perMin:20}}}};
 return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
};
test('PinnOdds trial uses $0 full boards with 100/day and 20/minute quotas',()=>{
 assert.equal(PINNODDS_TRIAL_REST_COST_USD,0);
 assert.deepEqual(PINNODDS_TRIAL_DOCUMENTED_LIMITS,{perDay:100,perMinute:20});
 assert.equal(PINNODDS_CAPTURE_REQUESTS,15);
 const proof=verifyPinnoddsFreeTrial({plan:{id:'trial',limits:{perDay:100,perMin:20}}});
 assert.equal(proof.perRequestUsd,0);
 assert.throws(()=>verifyPinnoddsFreeTrial({plan:{id:'pro',limits:{perDay:100,perMin:20}}}),/FREE_PLAN_NOT_VERIFIED/);
 assert.throws(()=>verifyPinnoddsFreeTrial({plan:{id:'trial'}}),/FREE_QUOTA_NOT_VERIFIED/);
});
test('optional narrow event-scoped helper still rejects unverified provider event IDs',()=>{
 assert.equal(requireProjectedFreeScope({kind:'prematch_event',canonicalEventId:'modeled',providerEventId:123}).costUsd,0);
 assert.throws(()=>requireProjectedFreeScope({kind:'prematch_event',canonicalEventId:'modeled',providerEventId:'unverified'}),/PROJECTION_ONLY_EVENT_SCOPE_REQUIRED/);
});
test('whole-board retrieval reserves quota and archives immutable raw, tagged for modeled-only ingestion',async()=>{
 const R2_ARCHIVE=archive(),env={PINNODDS_API_KEY:'test-key',R2_ARCHIVE};
 const reservation=await reservePinnoddsRun(env,{runId:'run-one',scope:'full',now,fetchImpl:accountFetch()});
 assert.equal(reservation.requestsReserved,15);
 let requests=0;
 const fetchImpl=async(url,options)=>{
  requests++;
  assert.equal(url.searchParams.get('sport_id'),'1');
  assert.equal(url.searchParams.get('event_type'),'prematch');
  assert.equal(url.searchParams.get('include_specials'),'nested');
  assert.equal(options.headers['x-api-key'],'test-key');
  return new Response(JSON.stringify({events:[{event_id:42,home:'Home',away:'Away'}]}));
 };
 const config={runId:'run-one',kind:'board',sportId:1,feed:'prematch',now,fetchImpl};
 const receipt=await capturePinnoddsSnapshot(env,config);
 assert.equal(receipt.ok,true);
 assert.equal(receipt.projectionScope,'FBIS_MODELED_EVENTS_ONLY');
 assert.equal(receipt.providerCostUsd,0);
 assert.ok(R2_ARCHIVE.map.has(receipt.rawKey));
 assert.deepEqual(await capturePinnoddsSnapshot(env,config),receipt);
 assert.equal(requests,1);
});
test('90-request durable budget retains ten provider requests in reserve',async()=>{
 const env={PINNODDS_API_KEY:'key',R2_ARCHIVE:archive()};
 for(let i=0;i<6;i++)await reservePinnoddsRun(env,{
  runId:'full-'+i,now:new Date(+now+i*3600000),fetchImpl:accountFetch()
 });
 await assert.rejects(reservePinnoddsRun(env,{
  runId:'full-extra',now:new Date(+now+6*3600000),fetchImpl:accountFetch()
 }),/DAILY_CAPTURE_BUDGET_EXHAUSTED/);
});
test('per-minute budget, account exhaustion and inactive subscription fail closed',async()=>{
 const env={PINNODDS_API_KEY:'key',R2_ARCHIVE:archive()};
 await reservePinnoddsRun(env,{runId:'first',now,fetchImpl:accountFetch()});
 await assert.rejects(reservePinnoddsRun(env,{runId:'second',now,fetchImpl:accountFetch()}),/MINUTE_BUDGET_EXHAUSTED/);
 await assert.rejects(reservePinnoddsRun(env,{runId:'exhausted',now:new Date(+now+3600000),fetchImpl:accountFetch(92)}),/INSUFFICIENT_EXISTING_DAILY_QUOTA/);
 await assert.rejects(reservePinnoddsRun(env,{runId:'inactive',now:new Date(+now+7200000),fetchImpl:accountFetch(10,'inactive')}),/UNVERIFIED_ACCOUNT_ENTITLEMENT/);
});
test('ambiguous provider failure never triggers repeat quota-consuming request',async()=>{
 const env={PINNODDS_API_KEY:'key',R2_ARCHIVE:archive()};
 await reservePinnoddsRun(env,{runId:'bad',now,fetchImpl:accountFetch()});
 let calls=0;
 const fetchImpl=async()=>{calls++;return new Response('',{status:503});};
 const input={runId:'bad',kind:'board',sportId:6,feed:'prematch',now,fetchImpl};
 await assert.rejects(capturePinnoddsSnapshot(env,input),/PROVIDER_HTTP_503/);
 await assert.rejects(capturePinnoddsSnapshot(env,input),/NO_AUTOMATIC_RECHARGE/);
 assert.equal(calls,1);
});
