import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {startPaidAcquisition,captureAcquisitionRaw,billingWindow,canonicalScope} from '../functions/lib/externalAcquisition.js';
import {onRequestGet as health} from '../functions/api/acquisition-health.js';
import {onRequestPost as consumePrizePicks} from '../functions/api/prizepicks-props.js';
const now=new Date('2026-10-07T20:00:00Z');
function fixture({active=true,usage=0}={}){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT)');sql.exec(readFileSync(new URL('../migrations/0097_apify_acquisition_authority.sql',import.meta.url),'utf8'));
 sql.prepare("UPDATE external_acquisition_account SET state=?,reason='test-account',period_start='2026-09-12T00:00:00.000Z',period_end='2026-10-12T00:00:00.000Z',provider_usage_usd=?,usage_observed_at=?").run(active?'ACTIVE':'BLOCKED',usage,now.toISOString());
 sql.exec("UPDATE external_acquisition_policy SET state='ACTIVE'");
 const DB={prepare(query){const st=sql.prepare(query);const bound=params=>({first:async()=>st.get(...params)||null,all:async()=>({results:st.all(...params)}),run:async()=>({meta:{changes:Number(st.run(...params).changes)}})});return {...bound([]),bind:(...params)=>bound(params)};}};
 const objects=new Map(),ARCHIVE={head:async k=>objects.get(k)||null,put:async(k,p,o)=>objects.set(k,{payload:p,...o})};
 return {env:{DB,ARCHIVE,APIFY_TOKEN:'test-not-real'},sql,objects};
}
const request={source:'action',input:{leagues:['nfl','mlb'],maxGames:10},component:'consumer-a',sport:'nfl',now};
function provider(calls,{fail=false}={}){return async(url,opts)=>{if(opts?.method!=='POST')return new Response(JSON.stringify({data:{id:'provider-1',status:'RUNNING',defaultDatasetId:'dataset-1',startedAt:now.toISOString()}}));calls.push({url,opts});if(fail)throw Error('connection lost after provider accepted');return new Response(JSON.stringify({data:{id:'provider-'+calls.length,status:'RUNNING',defaultDatasetId:'dataset-'+calls.length,startedAt:now.toISOString()}}),{status:201});};}
test('billing period follows account reset day, not calendar month',()=>{
 assert.deepEqual(billingWindow(now),{start:'2026-09-12T00:00:00.000Z',end:'2026-10-12T00:00:00.000Z'});
 assert.equal(billingWindow(new Date('2026-10-12T00:00:00Z')).start,'2026-10-12T00:00:00.000Z');
});
test('equivalent league scopes have deterministic shared identity',()=>{
 assert.deepEqual(canonicalScope({leagues:['nfl','mlb','nfl']}),canonicalScope({leagues:['mlb','nfl']}));
});
test('simultaneous subscriber demand yields exactly one paid launch and pre-launch reserve',async()=>{
 const {env,sql}=fixture(),calls=[];const fetchImpl=provider(calls);
 await Promise.all([startPaidAcquisition(env,{...request,fetchImpl}),startPaidAcquisition(env,{...request,component:'consumer-b',fetchImpl})]);
 assert.equal(calls.length,1);assert.equal(sql.prepare('SELECT count(*) n FROM external_acquisitions').get().n,1);
 assert.match(calls[0].url,/maxTotalChargeUsd=1.5/);
 const reuse=await startPaidAcquisition(env,{...request,component:'consumer-b',fetchImpl});assert.equal((await reuse.json()).reused,true);assert.equal(calls.length,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM external_acquisition_consumers').get().n,2);
});
test('ambiguous transport never permits a replacement paid run, including later freshness windows',async()=>{
 const {env,sql}=fixture(),calls=[];const fetchImpl=provider(calls,{fail:true});
 await startPaidAcquisition(env,{...request,fetchImpl});await startPaidAcquisition(env,{...request,fetchImpl,now:new Date(+now+86400000)});
 assert.equal(calls.length,1);assert.equal(sql.prepare('SELECT state FROM external_acquisitions').get().state,'UNKNOWN_START');
});
test('budget reservations serialize across different sports/scopes',async()=>{
 const {env}=fixture({usage:20}),calls=[];const fetchImpl=provider(calls);
 await Promise.all([startPaidAcquisition(env,{...request,fetchImpl}),startPaidAcquisition(env,{...request,input:{leagues:['nhl']},sport:'nhl',fetchImpl})]);
 assert.equal(calls.length,1);
});
test('restricted account, missing durability and stale account usage all fail before external launch',async()=>{
 const calls=[],fetchImpl=provider(calls),{env}=fixture({active:false});
 assert.equal((await startPaidAcquisition(env,{...request,fetchImpl})).status,409);
 assert.equal((await startPaidAcquisition({APIFY_TOKEN:'test'}, {...request,fetchImpl})).status,503);
 const active=fixture();active.sql.exec("UPDATE external_acquisition_account SET usage_observed_at='2026-10-07T18:00:00.000Z'");
 assert.equal((await startPaidAcquisition(active.env,{...request,fetchImpl})).status,409);assert.equal(calls.length,0);
});
test('raw capture records source time, cost provenance and zero results without restamping reused data',async()=>{
 const {env,sql,objects}=fixture(),calls=[];await startPaidAcquisition(env,{...request,fetchImpl:provider(calls)});
 const run={id:'provider-1',status:'SUCCEEDED',defaultDatasetId:'dataset-1',startedAt:now.toISOString(),finishedAt:'2026-10-07T20:00:05.000Z',usageTotalUsd:0.05};
 const raw=await captureAcquisitionRaw(env,{run,rows:[]});await captureAcquisitionRaw(env,{run,rows:[]});
 assert.equal(objects.size,1);assert.equal(raw.acquiredAt,run.finishedAt);
 const row=sql.prepare('SELECT * FROM external_acquisitions').get();assert.equal(row.state,'CAPTURED');assert.equal(row.observations_returned,0);assert.equal(row.provider_cost_usd,0.05);assert.equal(row.cost_provenance,'PROVIDER_REPORTED_RUN_USAGE');
 await assert.rejects(captureAcquisitionRaw(env,{run,rows:[{changed:true}]}),/immutable-raw-conflict/);
});
test('source health distinguishes blocked from missing measurement',async()=>{
 const {env}=fixture({active:false});assert.equal((await (await health({env})).json()).status,'BLOCKED');assert.equal((await (await health({env:{}})).json()).status,'UNKNOWN');
});
test('large canonical payload is rejected before archival, SQL writes or model enrichment',async()=>{
 const {env,sql,objects}=fixture();env.HARVEST_SECRET='secret';
 const response=await consumePrizePicks({env,request:new Request('https://example.test/api/prizepicks-props',{method:'POST',headers:{'x-harvest-secret':'secret','content-type':'application/json'},body:JSON.stringify({runId:'current-run',rows:Array.from({length:501},()=>({player_name:'Player'}))})})});
 assert.equal(response.status,413);assert.equal((await response.json()).error,'bounded_consumption_required');assert.equal(objects.size,0);assert.equal(sql.prepare('SELECT count(*) n FROM external_acquisition_batches').get().n,0);
});
test('live consumers exclude partial and stale captures while retaining historical rows',()=>{
 const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE prizepicks_daily_acquisitions(run_id TEXT,state TEXT);CREATE TABLE prizepicks_prop_lines(run_id TEXT,collected_at TEXT)");
 sql.exec("INSERT INTO prizepicks_daily_acquisitions VALUES('partial','RESERVED'),('fresh','COMPLETE'),('old','COMPLETE');INSERT INTO prizepicks_prop_lines VALUES('partial',strftime('%Y-%m-%dT%H:%M:%fZ','now')),('fresh',strftime('%Y-%m-%dT%H:%M:%fZ','now')),('old',strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'))");
 const guard="run_id IN (SELECT run_id FROM prizepicks_daily_acquisitions WHERE state='COMPLETE') AND julianday(collected_at) BETWEEN julianday('now','-24 hours') AND julianday('now')";
 assert.deepEqual(sql.prepare('SELECT run_id FROM prizepicks_prop_lines WHERE '+guard).all().map(r=>r.run_id),['fresh']);assert.equal(sql.prepare('SELECT count(*) n FROM prizepicks_prop_lines').get().n,3);
 for(const path of ['functions/api/player-props.js','functions/api/selective-props.js','functions/lib/todayBoard.js','functions/api/prop-enrich-current.js','functions/api/nfl-prop-enrich.js'])assert.ok(readFileSync(new URL('../'+path,import.meta.url),'utf8').includes(guard),path);
});
test('production workflows have no direct paid Actor launches or PR-triggered paid capability probes',()=>{
 for(const f of readdirSync(new URL('../.github/workflows/',import.meta.url))){const s=readFileSync(new URL('../.github/workflows/'+f,import.meta.url),'utf8');assert.doesNotMatch(s,/api\.apify\.com\/v2\/acts\/.*(?:run-sync|\/runs)/,f);}
 const probe=readFileSync(new URL('../.github/workflows/tennis-action-capability-probe.yml',import.meta.url),'utf8');assert.doesNotMatch(probe,/pull_request:/);
 const collector=readFileSync(new URL('../functions/lib/actionApifyCollector.js',import.meta.url),'utf8');assert.match(collector,/const maxRetries = 0/);
});
