import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshExchangeFixtures} from '../services/polymarket-rest-collector/fixtures.mjs';
import {CERTIFIED_EXECUTION_JOBS} from '../services/account-budget/executionJobs.mjs';
const event=(id,date)=>({id,date,status:{type:{state:'pre'}},competitions:[{id,date,competitors:[{homeAway:'home',team:{id:'1',displayName:'Home'}},{homeAway:'away',team:{id:'2',displayName:'Away'}}]}]});
function env(sport){const writes=[];return {writes,CLOUDFLARE_ACCOUNT_ID:'test',FBIS_POLYMARKET_TAGS_JSON:JSON.stringify({[sport]:[sport]}),FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async({job})=>({allowed:true,maxUnits:CERTIFIED_EXECUTION_JOBS[job].units,expiresAtMs:Date.now()+120000})})},ARCHIVE:{head:async()=>null,put:async(key,value)=>{writes.push(JSON.parse(value));return {etag:'saved'};}}};}
test('Friday football fixture refresh includes Sunday without extra calls or beyond-horizon fixtures',async()=>{
 const now=Date.parse('2026-11-07T00:00:00Z'),config=env('nfl');let calls=0;
 const result=await refreshExchangeFixtures(config,{sport:'nfl',slot:1,now,fetchImpl:async url=>{calls++;assert.equal(new URL(url).searchParams.get('dates'),'20261106-20261109');return Response.json({events:[event('1','2026-11-08T18:00:00Z'),event('2','2026-11-10T01:00:00Z')]});}});
 assert.equal(calls,1);assert.equal(result.fixtures,1);assert.equal(config.writes[0].fixtures[0].id,'1');assert.equal(config.writes[0].canAuthorizeWager,false);
});
test('basketball retains single-day request and existing fixture cap',async()=>{
 const now=Date.parse('2026-11-07T00:00:00Z'),config=env('nba');
 const result=await refreshExchangeFixtures(config,{sport:'nba',slot:1,now,fetchImpl:async url=>{assert.equal(new URL(url).searchParams.get('dates'),'20261106');return Response.json({events:[event('1','2026-11-07T01:00:00Z'),event('2','2026-11-08T18:00:00Z')]});}});
 assert.equal(result.fixtures,1);
});
