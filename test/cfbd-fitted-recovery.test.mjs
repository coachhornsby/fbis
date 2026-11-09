import test from 'node:test';import assert from 'node:assert/strict';
import {captureCfbdPpaGames,projectCfbdFittedRecovery}from'../scripts/lib/cfbdFittedRecovery.mjs';
const now=Date.parse('2026-11-09T05:00:00Z');
const game={sport:'cfb',start:'2026-11-14T20:00:00Z',neutralSite:false,home:{espnId:'251'},away:{espnId:'201'}};
const ppa={endpoint:'/ppa/games',query:{year:2026},capturedAt:new Date(now).toISOString(),responseSha256:'a'.repeat(64),rows:['cfb-251','cfb-201'].flatMap((id,j)=>[1,2,3].map(i=>({canonicalId:id,year:2026,gameId:String(i),startDate:`2026-10-0${i}T20:00:00Z`,completed:true,offensePpa:.1+j*.1,defensePpa:.05})))};
const prior={sourceSeason:2025,frozen:true,featureContract:'ppa-derived-base-v2',rows:['cfb-251','cfb-201'].map(canonicalId=>({canonicalId,priorOff:30,priorDef:24,sourceSeason:2025}))};
test('frozen production coefficients consume real per-game PPA and retain no-wager gates',()=>{
 const p=projectCfbdFittedRecovery(game,{ppaPacket:ppa,priorPacket:prior,now});assert.equal(p.ok,true);assert.equal(p.model.fittedApplied,true);assert.equal(p.canAuthorizeWager,false);assert.equal(p.provenance.featureContract,'ppa-derived-base-v2');
 const changed=structuredClone(ppa);changed.rows[0].offensePpa+=.2;const q=projectCfbdFittedRecovery(game,{ppaPacket:changed,priorPacket:prior,now});assert.notEqual(p.model.margin,q.model.margin);assert.notEqual(p.model.total,q.model.total);
});
test('CORE, season aggregate, missing prior or temporal evidence cannot silently enter fitted model',()=>{
 for(const override of [{endpoint:'/ratings/core'},{endpoint:'/ppa/teams'},{capturedAt:'2026-11-15T00:00:00Z'},{capturedAt:'2026-11-08T00:00:00Z'},{rows:ppa.rows.map(r=>({...r,startDate:null}))},{rows:ppa.rows.map(r=>({...r,completed:undefined}))}])assert.equal(projectCfbdFittedRecovery(game,{ppaPacket:{...ppa,...override},priorPacket:prior,now}).ok,false);
 assert.equal(projectCfbdFittedRecovery(game,{ppaPacket:ppa,now}).reason,'FROZEN_PRIOR_SEASON_INPUT_UNAVAILABLE');
});
test('one PPA capture retains missing kickoff/completion honestly; no extra fetch',async()=>{
 let calls=0;const r=await captureCfbdPpaGames({key:'not-a-real-key',now,fetchFn:async()=>{calls++;return new Response(JSON.stringify([{team:'Texas',gameId:123,year:2026,week:10,offense:{overall:.2},defense:{overall:.1}}]));}});assert.equal(calls,1);assert.equal(r.packet.rows[0].canonicalId,'cfb-251');assert.equal(r.packet.rows[0].startDate,null);assert.equal(r.packet.rows[0].completed,undefined);assert.equal(r.receipt.requests,1);assert.ok(!JSON.stringify(r).includes('not-a-real-key'));
});

test('weekly adjusted metrics and market spread cannot leak into raw-PPA frozen scores',async()=>{
 const {CFB_TIER3_FEATURE_COLUMNS}=await import('../functions/lib/cfbTier3FeatureRegistry.js');
 const baseline=projectCfbdFittedRecovery(game,{ppaPacket:ppa,priorPacket:prior,now});
 const uploadedFeatures=Object.fromEntries(CFB_TIER3_FEATURE_COLUMNS.map((k,i)=>[k,(i+1)*10000]));
 const decorated={...game,...uploadedFeatures,spread:-999,openingSpread:999,weeklyReport:{features:uploadedFeatures,spread:999}};
 const result=projectCfbdFittedRecovery(decorated,{ppaPacket:ppa,priorPacket:prior,now});
 for(const key of ['home','away','margin','total','pHomeWin','fairHomeMl','fairAwayMl','marginFeatures','totalFeatures'])assert.deepEqual(result.model[key],baseline.model[key]);
 assert.deepEqual(result.provenance,baseline.provenance);
});

test('private fitted provenance carries exact prior and completion evidence without changing scores',()=>{
 const base=projectCfbdFittedRecovery(game,{ppaPacket:ppa,priorPacket:prior,now});
 const priorPacket={...prior,rows:prior.rows.map(r=>({...r,artifactHash:'b'.repeat(64)})),provenance:{sp:{responseSha256:'c'.repeat(64),capturedAt:new Date(now).toISOString()}}};
 const completionEvidence={responseSha256:'d'.repeat(64),capturedAt:new Date(now).toISOString()};
 const result=projectCfbdFittedRecovery(game,{ppaPacket:{...ppa,scheduleProvenance:completionEvidence},priorPacket,now});
 assert.equal(result.provenance.priorArtifactHashes.home,'b'.repeat(64));assert.deepEqual(result.provenance.completionEvidence,completionEvidence);assert.deepEqual(result.provenance.priorSourceProvenance,priorPacket.provenance);
 assert.equal(result.model.total,base.model.total);assert.equal(result.model.margin,base.model.margin);
});
