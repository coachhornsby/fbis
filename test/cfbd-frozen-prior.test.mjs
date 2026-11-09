import test from 'node:test';import assert from 'node:assert/strict';
import {captureCfbdFrozenPrior,captureCfbdCompletionSchedule,attachCfbdCompletionEvidence}from'../scripts/lib/cfbdFrozenPrior.mjs';
import {buildPriorCatalog}from'../functions/lib/cfbFeaturePipeline.js';
const data={sp:[{team:'Texas',year:2025,rating:20,offense:{rating:35},defense:{rating:18}},{team:'Oklahoma',rating:5,offense:{},defense:{rating:20}}],talent:[{school:'Texas',year:2025,talent:900}],returning:[{team:'Texas',percentPPA:.7}],recruiting:[{team:'Texas',year:2025,points:300}]};
test('four bounded calls preserve exact existing SP prior math and source provenance',async()=>{
 const calls=[],reserved=[];const paths={'/ratings/sp':'sp','/talent':'talent','/player/returning':'returning','/recruiting/teams':'recruiting'};
 const result=await captureCfbdFrozenPrior({key:'fake',now:Date.parse('2026-11-09T05:00:00Z'),reserve:x=>reserved.push(x),fetchFn:async url=>{calls.push(url);assert.equal(new URL(url).searchParams.get('year'),'2025');return new Response(JSON.stringify(data[paths[new URL(url).pathname]]));}});
 const expected=buildPriorCatalog({season:2025,endpoints:Object.fromEntries(Object.entries(data).map(([k,data])=>[k,{data}]))}).bySchool.texas;
 assert.equal(calls.length,4);assert.equal(reserved.length,4);assert.equal(result.packet.rows.length,1);assert.equal(result.packet.rows[0].priorOff,expected.priorOff);assert.equal(result.packet.rows[0].priorDef,expected.priorDef);assert.equal(result.packet.sourceSeason,2025);assert.equal(result.packet.provenance.sp.responseSha256.length,64);assert.ok(!JSON.stringify(result).includes('fake'));
});
test('schedule join requires exact game/team/season, completed flag, scores and valid kickoff',()=>{
 const ppa={query:{year:2026},rows:[{gameId:'1',canonicalId:'cfb-251',year:2026}]};
 const game={id:1,season:2026,homeTeam:'Texas',awayTeam:'Oklahoma',completed:true,homePoints:20,awayPoints:7,startDate:'2026-10-10T20:00:00Z'};
 const schedule={query:{year:2026},endpoint:'/games',data:[game]};
 assert.equal(attachCfbdCompletionEvidence(ppa,schedule).rows[0].completed,true);
 for(const override of [{completed:false},{homePoints:null},{season:2025},{homeTeam:'Alabama'},{startDate:null}])assert.equal(attachCfbdCompletionEvidence(ppa,{...schedule,data:[{...game,...override}]}).rows[0].completed,false);
 assert.throws(()=>attachCfbdCompletionEvidence(ppa,{...schedule,data:[game,game]}),/DUPLICATE/);
});
test('schedule capture consumes one reserved request and retains raw completion evidence',async()=>{
 let count=0;const r=await captureCfbdCompletionSchedule({key:'fake',reserve:()=>count++,fetchFn:async()=>new Response('[]')});assert.equal(count,1);assert.equal(r.receipt.requests,1);assert.equal(r.packet.endpoint,'/games');
});
