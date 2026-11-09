import test from 'node:test';import assert from 'node:assert/strict';
import {captureCfbdPpaGames,projectCfbdFittedRecovery}from'../scripts/lib/cfbdFittedRecovery.mjs';
const now=Date.parse('2026-11-09T05:00:00Z');
const game={id:'4',sport:'cfb',start:'2026-11-14T20:00:00Z',neutralSite:false,home:{espnId:'251'},away:{espnId:'201'}};
const ppa={endpoint:'/ppa/games',query:{year:2026},capturedAt:new Date(now).toISOString(),responseSha256:'a'.repeat(64),rows:['cfb-251','cfb-201'].flatMap((id,j)=>[1,2,3].map(i=>({canonicalId:id,year:2026,gameId:String(i),startDate:`2026-10-0${i}T20:00:00Z`,completed:true,offensePpa:.1+j*.1,defensePpa:.05})))};
const prior={sourceSeason:2025,frozen:true,featureContract:'ppa-derived-base-v2',rows:['cfb-251','cfb-201'].map(canonicalId=>({canonicalId,priorOff:30,priorDef:24,sourceSeason:2025}))};
const schedule={endpoint:'/games',query:{year:2026},capturedAt:ppa.capturedAt,data:[...[1,2,3].map(i=>({id:i,season:2026,seasonType:'regular',homeTeam:'Texas',awayTeam:'Oklahoma',startDate:`2026-10-0${i}T20:00:00Z`,completed:true,homePoints:30,awayPoints:20})),{id:4,season:2026,seasonType:'regular',homeTeam:'Texas',awayTeam:'Oklahoma',startDate:game.start,completed:false}]};
test('frozen production coefficients consume real per-game PPA and retain no-wager gates',()=>{
 const p=projectCfbdFittedRecovery(game,{ppaPacket:ppa,priorPacket:prior,schedulePacket:schedule,now});assert.equal(p.ok,true);assert.equal(p.model.fittedApplied,true);assert.equal(p.canAuthorizeWager,false);assert.equal(p.provenance.featureContract,'ppa-derived-base-v2');
 const changed=structuredClone(ppa);changed.rows[0].offensePpa+=.2;const q=projectCfbdFittedRecovery(game,{ppaPacket:changed,priorPacket:prior,schedulePacket:schedule,now});assert.notEqual(p.model.margin,q.model.margin);assert.notEqual(p.model.total,q.model.total);
});
test('CORE, season aggregate, missing prior or temporal evidence cannot silently enter fitted model',()=>{
 for(const override of [{endpoint:'/ratings/core'},{endpoint:'/ppa/teams'},{capturedAt:'2026-11-15T00:00:00Z'},{capturedAt:'2026-11-05T00:00:00Z'},{rows:ppa.rows.map(r=>({...r,startDate:null}))},{rows:ppa.rows.map(r=>({...r,completed:undefined}))}])assert.equal(projectCfbdFittedRecovery(game,{ppaPacket:{...ppa,...override},priorPacket:prior,schedulePacket:schedule,now}).ok,false);
 assert.equal(projectCfbdFittedRecovery(game,{ppaPacket:ppa,schedulePacket:schedule,now}).reason,'FROZEN_PRIOR_SEASON_INPUT_UNAVAILABLE');
});
test('one PPA capture retains missing kickoff/completion honestly; no extra fetch',async()=>{
 let calls=0;const r=await captureCfbdPpaGames({key:'not-a-real-key',now,fetchFn:async()=>{calls++;return new Response(JSON.stringify([{team:'Texas',gameId:123,year:2026,week:10,offense:{overall:.2},defense:{overall:.1}}]));}});assert.equal(calls,1);assert.equal(r.packet.rows[0].canonicalId,'cfb-251');assert.equal(r.packet.rows[0].startDate,null);assert.equal(r.packet.rows[0].completed,undefined);assert.equal(r.receipt.requests,1);assert.ok(!JSON.stringify(r).includes('not-a-real-key'));
});

test('recent capture still requires full coverage at exported consumer',()=>{const missing=structuredClone(ppa);missing.rows.pop();assert.equal(projectCfbdFittedRecovery(game,{ppaPacket:missing,priorPacket:prior,schedulePacket:schedule,now}).ok,false);assert.equal(projectCfbdFittedRecovery(game,{ppaPacket:ppa,priorPacket:prior,now}).ok,false);});
