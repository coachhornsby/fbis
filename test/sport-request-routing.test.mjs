import test from 'node:test';
import assert from 'node:assert/strict';
import {SPORT_DATABASES,productSportDbHandle} from '../functions/lib/databaseTopology.js';
import {sportRequestRouting,hydrateRequestSportRouting} from '../functions/lib/sportRequestRouting.js';
import {loadDurableTodayGames} from '../functions/lib/todayDurableFallback.js';
import {todayEnv} from '../functions/api/today.js';
const date='2026-10-30',now=Date.parse('2026-10-30T18:00:00Z');
const sports=Object.keys(SPORT_DATABASES);
function fixture(sport,index=0,score=28){return {id:String(401000000+index),sport,date,start:'2026-10-30T23:00:00Z',home_name:'Texas',away_name:'Oklahoma',frozen_at:'2026-10-30T15:00:00Z',proj_home:score,proj_away:21,model_version:'unchanged'};}
function database(rows=[],failure=false){
 return {calls:[],prepare(sql){
  this.calls.push({sql});const call=this.calls.at(-1);
  return {bind(...args){
   call.args=args;
   return {async all(){if(failure)throw Error('SHARD_UNAVAILABLE');return {results:rows};}};
  }};
 }};
}
function setup(active=sports){
 const env={DB:database([])};const reads=[];
 env.CORE_DB={prepare:sql=>({bind:(sport,receipt)=>({first:async()=>{
  reads.push({sql,sport,receipt});
  return {sport,receipt_id:receipt,status:'APPROVED',approved_at:'2026-10-01',expires_at:'2099-01-01',revoked_at:null};
 }})})};
 for(const [i,sport] of sports.entries()) {
  env[SPORT_DATABASES[sport].binding]=database([fixture(sport,i)]);
  env['SPORT_DB_MODE_'+sport.toUpperCase()]=active.includes(sport)?'sport':'shadow';
  env['SPORT_CUTOVER_RECEIPT_'+sport.toUpperCase()]='receipt-'+sport;
  env['SPORT_DB_LEDGER_READY_'+sport.toUpperCase()]='true';
 }
 return {env,reads};
}
test('reduced TODAY environment keeps all 11 routing capabilities and excludes collector/retired capabilities',()=>{
 const {env}=setup();env.MARKET_HISTORY_DB=database();env.COLD_HISTORY_DB=database();env.HARVEST_SECRET='secret';env.FBIS_POLYMARKET_TAGS_JSON='collector-config';env.__fbisCutoverApprovals=new Map([['injected',{}]]);
 const original=globalThis.caches;globalThis.caches={default:{}};
 try {
  const scoped=todayEnv({env});
  for(const [sport,plan] of Object.entries(SPORT_DATABASES)) {
   assert.equal(scoped[plan.binding],env[plan.binding]);
   for(const p of ['SPORT_DB_MODE_','SPORT_CUTOVER_RECEIPT_','SPORT_DB_LEDGER_READY_'])assert.equal(scoped[p+sport.toUpperCase()],env[p+sport.toUpperCase()]);
  }
  for(const key of ['MARKET_HISTORY_DB','COLD_HISTORY_DB','HARVEST_SECRET','FBIS_POLYMARKET_TAGS_JSON','__fbisCutoverApprovals'])assert.equal(scoped[key],undefined);
  assert.equal(scoped.CORE_DB,env.CORE_DB);
 } finally {if(original===undefined)delete globalThis.caches;else globalThis.caches=original;}
});
test('approval hydration uses exactly one receipt lookup per active sport and drops stale maps',async()=>{
 const {env,reads}=setup();const prior=new Map([['old',{}]]);env.__fbisCutoverApprovals=prior;
 const out=await hydrateRequestSportRouting(env);
 assert.equal(out.ok,true);assert.equal(reads.length,11);assert.notEqual(env.__fbisCutoverApprovals,prior);assert.equal(env.__fbisCutoverApprovals.has('old'),false);
 for(const r of reads){assert.match(r.sql,/WHERE sport=\? AND receipt_id=\? LIMIT 1/);assert.equal(r.receipt,'receipt-'+r.sport);}
 for(const sport of sports)assert.equal(productSportDbHandle(env,sport).binding,SPORT_DATABASES[sport].binding);
});
for(const sport of sports)test(sport+' active authority failure never reads PRIMARY',async()=>{
 const {env}=setup([sport]);delete env.CORE_DB;
 const r=await loadDurableTodayGames(env,date,sport,{now});
 assert.equal(r.ok,false);assert.deepEqual(r.games,[]);assert.equal(env.DB.calls.length,0);assert.equal(env[SPORT_DATABASES[sport].binding].calls.length,0);
});
test('all-sport delivery reads all 11 approved owners without touching PRIMARY',async()=>{
 const {env,reads}=setup();env.DB.prepare=()=>{throw Error('PRIMARY_MUST_NOT_BE_READ');};
 const r=await loadDurableTodayGames(env,date,'all',{now});
 assert.equal(r.ok,true,r.reason);assert.equal(r.games.length,11);assert.equal(reads.length,11);assert.equal(r.bindings.length,11);
 assert.equal(r.canAuthorizeWager,false);for(const g of r.games){assert.equal(g.canAuthorizeWager,false);assert.equal(g.canQualify,false);assert.equal(g.status.live,false);assert.equal(g.model.pHomeFinal,null);}
});
test('mixed fanout excludes active sports from PRIMARY SQL and rejects stale duplicate slices',async()=>{
 const {env}=setup(['cfb','nfl']);env.DB=database([fixture('cfb',sports.indexOf('cfb'),99),fixture('nfl',sports.indexOf('nfl'),99),fixture('nba',999,33)]);
 const r=await loadDurableTodayGames(env,date,'all',{now});assert.equal(r.ok,true,r.reason);assert.equal(r.games.length,3);
 assert.equal(r.games.find(g=>g.sport==='cfb').model.projHome,28);assert.equal(r.games.find(g=>g.sport==='nba').model.projHome,33);
 assert.match(env.DB.calls[0].sql,/g.sport NOT IN \(\?,\?\)/);assert.deepEqual(new Set(env.DB.calls[0].args.slice(4)),new Set(['cfb','nfl']));
});
test('a failed active shard makes the response unavailable instead of using PRIMARY',async()=>{
 const {env}=setup(['nba']);env.NBA_DB=database([],true);
 const r=await loadDurableTodayGames(env,date,'nba',{now});assert.equal(r.ok,false);assert.match(r.reason,/SHARD_UNAVAILABLE/);assert.equal(env.DB.calls.length,0);
});
test('moved shared ledgers remain blocked until their separate ledger-ready gate passes',async()=>{
 const {env}=setup(['mlb']);env.SPORT_DB_LEDGER_READY_MLB='false';const r=await loadDurableTodayGames(env,date,'mlb',{now});
 assert.equal(r.ok,false);assert.match(r.reason,/SPORT_LEDGER_NOT_QUALIFIED/);assert.equal(env.DB.calls.length,0);assert.equal(env.MLB_DB.calls.length,0);
});
for(const patch of [{revoked_at:'2026-10-01'},{expires_at:'2000-01-01'},{expires_at:'broken'},{status:'PENDING'},{sport:'nfl'},{receipt_id:'wrong'}])test('invalid approval is rejected: '+JSON.stringify(patch),async()=>{
 const {env}=setup(['nba']);env.__fbisCutoverApprovals=new Map([['nba:receipt-nba',{status:'APPROVED'}]]);
 env.CORE_DB={prepare:()=>({bind:()=>({first:async()=>({sport:'nba',receipt_id:'receipt-nba',status:'APPROVED',...patch})})})};
 const r=await loadDurableTodayGames(env,date,'nba',{now});assert.equal(r.ok,false);assert.equal(env.DB.calls.length,0);assert.equal(env.NBA_DB.calls.length,0);
});
test('CORE read failure cannot use an injected or previously hydrated approval',async()=>{
 const {env}=setup(['cfb']);env.__fbisCutoverApprovals=new Map([['cfb:receipt-cfb',{status:'APPROVED'}]]);env.CORE_DB={prepare(){throw Error('CORE_DOWN');}};
 const r=await loadDurableTodayGames(env,date,'cfb',{now});assert.equal(r.ok,false);assert.equal(env.__fbisCutoverApprovals.size,0);assert.equal(env.DB.calls.length,0);
});
test('shadow sports keep their current authority without activating bound shards',async()=>{
 const {env,reads}=setup([]);env.DB=database([fixture('mlb')]);const r=await loadDurableTodayGames(env,date,'mlb',{now});assert.equal(r.ok,true);assert.equal(reads.length,0);assert.equal(env.MLB_DB.calls.length,0);
});
