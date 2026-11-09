import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshExchangeFixtures} from '../services/polymarket-rest-collector/fixtures.mjs';
import {CERTIFIED_EXECUTION_JOBS} from '../services/account-budget/executionJobs.mjs';
const event=(id,date)=>({id,date,status:{type:{state:'pre'}},competitions:[{id,date,competitors:[{homeAway:'home',team:{id:'1',displayName:'Home'}},{homeAway:'away',team:{id:'2',displayName:'Away'}}]}]});
function env(sport){const writes=[];return {writes,CLOUDFLARE_ACCOUNT_ID:'test',FBIS_POLYMARKET_TAGS_JSON:JSON.stringify({[sport]:[sport]}),FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async({job})=>({allowed:true,maxUnits:CERTIFIED_EXECUTION_JOBS[job].units,expiresAtMs:Date.now()+120000})})},ARCHIVE:{head:async()=>null,put:async(key,value)=>{writes.push(JSON.parse(value));return {etag:'saved'};}}};}
test('Friday football uses supported current-week query and includes Sunday within the horizon',async()=>{
 const now=Date.parse('2026-11-07T00:00:00Z'),config=env('nfl');let calls=0;
 const result=await refreshExchangeFixtures(config,{sport:'nfl',slot:1,now,fetchImpl:async url=>{calls++;assert.equal(new URL(url).searchParams.get('dates'),null);return Response.json({events:[event('1','2026-11-08T18:00:00Z'),event('2','2026-11-10T01:00:00Z')]});}});
 assert.equal(calls,1);assert.equal(result.fixtures,1);assert.equal(config.writes[0].fixtures[0].id,'1');assert.equal(config.writes[0].canAuthorizeWager,false);
});
test('basketball retains single-day request and existing fixture cap',async()=>{
 const now=Date.parse('2026-11-07T00:00:00Z'),config=env('nba');
 const result=await refreshExchangeFixtures(config,{sport:'nba',slot:1,now,fetchImpl:async url=>{assert.equal(new URL(url).searchParams.get('dates'),'20261106');return Response.json({events:[event('1','2026-11-07T01:00:00Z'),event('2','2026-11-08T18:00:00Z')]});}});
 assert.equal(result.fixtures,1);
});
test('pregame basketball includes next board day in one bounded range request',async()=>{
 const now=Date.parse('2026-11-09T03:30:00Z'),config={...env('cbb'),FBIS_POLYMARKET_PREGAME_REST:'true'};let calls=0;
 const result=await refreshExchangeFixtures(config,{sport:'cbb',slot:1,now,fetchImpl:async url=>{calls++;const q=new URL(url).searchParams;assert.equal(q.get('dates'),'20261108-20261109');assert.equal(q.get('groups'),'50');return Response.json({events:[event('501','2026-11-09T04:00:00Z'),event('502','2026-11-10T00:00:00Z'),event('503','2026-11-12T04:00:00Z')]});}});
 assert.equal(calls,1);assert.equal(result.fixtures,2);assert.deepEqual(config.writes[0].fixtures.map(x=>x.id),['501','502']);
});
test('pregame horizon does not enlarge 100-fixture capacity',async()=>{
 const now=Date.parse('2026-11-09T03:30:00Z'),config={...env('cbb'),FBIS_POLYMARKET_PREGAME_REST:'true'};let calls=0;
 await assert.rejects(refreshExchangeFixtures(config,{sport:'cbb',slot:1,now,fetchImpl:async()=>{calls++;return Response.json({events:Array.from({length:101},(_,i)=>event(String(i),'2026-11-10T00:00:00Z'))});}}),/EXCHANGE_FIXTURE_CAPACITY_EXCEEDED/);
 assert.equal(calls,1);assert.equal(config.writes.length,0);
});
for(const sport of ['nba','nhl'])test(`${sport} pregame range handles year rollover in one request`,async()=>{
 const now=Date.parse('2026-12-31T23:30:00Z'),config={...env(sport),FBIS_POLYMARKET_PREGAME_REST:'true'};let calls=0;
 const result=await refreshExchangeFixtures(config,{sport,slot:1,now,fetchImpl:async url=>{calls++;assert.equal(new URL(url).searchParams.get('dates'),'20261231-20270101');return Response.json({events:[event('504','2027-01-02T01:00:00Z')]});}});
 assert.equal(calls,1);assert.equal(result.fixtures,1);
});
test('CBB range follows Chicago calendar through fall DST change',async()=>{
 const now=Date.parse('2026-11-01T05:30:00Z'),config={...env('cbb'),FBIS_POLYMARKET_PREGAME_REST:'true'};
 const result=await refreshExchangeFixtures(config,{sport:'cbb',slot:1,now,fetchImpl:async url=>{assert.equal(new URL(url).searchParams.get('dates'),'20261101-20261102');return Response.json({events:[event('505','2026-11-03T02:00:00Z')]});}});
 assert.equal(result.fixtures,1);
});
