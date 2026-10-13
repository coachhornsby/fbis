import test from 'node:test';import assert from 'node:assert/strict';
import {reservePinnoddsRun,capturePinnoddsSnapshot} from '../workers/pinnodds-governed-capture.mjs';
export function archive(){const map=new Map();let version=0;return{map,async get(key){const item=map.get(key);return item?{etag:item.etag,async json(){return JSON.parse(item.value)}}:null},async put(key,value,options={}){const prior=map.get(key);if(options.onlyIf?.etagDoesNotMatch==='*'&&prior||options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==prior?.etag)return null;const item={etag:'version-'+(++version),value};map.set(key,item);return item;}};}
const now=new Date('2026-10-13T12:00:00Z');
const accountFetch=(usage=16,status='active')=>async(url,options)=>{assert.equal(url,'https://mcp.pinnodds.com/mcp');const body=JSON.parse(options.body);return body.method==='notifications/initialized'?new Response(null,{status:202}):new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='initialize'?{}:{structuredContent:{status,usage_today:usage,plan:{id:'trial',limits:{perDay:100,perMin:20}}}}}));};
test('quota proof precedes odds calls; immutable slots prevent replay from charging again',async()=>{
 const env={PINNODDS_API_KEY:'private-key',R2_ARCHIVE:archive()};let calls=0;
 const reservation=await reservePinnoddsRun(env,{runId:'run-1',now,fetchImpl:accountFetch()});assert.equal(reservation.requestsReserved,15);
 const capture={runId:'run-1',kind:'board',sportId:6,feed:'prematch',now,fetchImpl:async(url,options)=>{calls++;assert.equal(url.searchParams.get('include_specials'),'1');assert.equal(options.headers['x-api-key'],'private-key');return new Response('{"events":[]}')}};
 const first=await capturePinnoddsSnapshot(env,capture);assert.equal(calls,1);assert.ok(env.R2_ARCHIVE.map.has(first.rawKey));
 assert.deepEqual(await capturePinnoddsSnapshot(env,capture),first);assert.equal(calls,1);
 await assert.rejects(capturePinnoddsSnapshot(env,{...capture,runId:'unreserved'}),/QUOTA_RESERVATION_REQUIRED/);assert.equal(calls,1);
});
test('unknown, inactive, exhausted and over-frequency accounts cannot charge odds requests',async()=>{
 const env={PINNODDS_API_KEY:'key',R2_ARCHIVE:archive()};
 await assert.rejects(reservePinnoddsRun(env,{runId:'exhausted',now,fetchImpl:accountFetch(90)}),/INSUFFICIENT_EXISTING_DAILY_QUOTA/);
 await assert.rejects(reservePinnoddsRun(env,{runId:'inactive',now,fetchImpl:accountFetch(0,'expired')}),/UNVERIFIED_ACCOUNT_ENTITLEMENT/);
 await reservePinnoddsRun(env,{runId:'one',now,fetchImpl:accountFetch()});
 await assert.rejects(reservePinnoddsRun(env,{runId:'two',now,fetchImpl:accountFetch()}),/MINUTE_BUDGET_EXHAUSTED/);
});
test('FBIS daily reservations fail closed before a fifth full run exceeds the budget',async()=>{
 const env={PINNODDS_API_KEY:'key',R2_ARCHIVE:archive()};
 for(let i=0;i<4;i++)await reservePinnoddsRun(env,{runId:'full-'+i,now:new Date(now.getTime()+i*3600000),fetchImpl:accountFetch()});
 await assert.rejects(reservePinnoddsRun(env,{runId:'full-5',now:new Date(now.getTime()+5*3600000),fetchImpl:accountFetch()}),/DAILY_CAPTURE_BUDGET_EXHAUSTED/);
});
test('ambiguous or failed upstream attempts never trigger automatic recharge',async()=>{
 const env={PINNODDS_API_KEY:'key',R2_ARCHIVE:archive()};await reservePinnoddsRun(env,{runId:'run-fail',now,fetchImpl:accountFetch()});let calls=0;
 const capture={runId:'run-fail',kind:'board',sportId:6,feed:'live',now,fetchImpl:async()=>{calls++;return new Response('',{status:503})}};
 await assert.rejects(capturePinnoddsSnapshot(env,capture),/PROVIDER_HTTP_503/);
 await assert.rejects(capturePinnoddsSnapshot(env,capture),/NO_AUTOMATIC_RECHARGE/);assert.equal(calls,1);
});
