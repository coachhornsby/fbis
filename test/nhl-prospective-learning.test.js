import test from 'node:test';import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {persistPropEvidence} from '../functions/lib/propEvidenceStore.js';
import {evaluateNhlProspectivePair,computeNhlProspectiveLearning} from '../functions/lib/nhlProspectiveLearning.js';
const p={canonicalEventId:'evt1',canonicalPlayerId:'nhl:nhl:8478402',canonical_market:'shots_on_goal',
 period:'full_game',independent:true,modelVersion:'nhl-v1',projection:3.5,
 modelAsOf:'2026-10-20T11:00:00Z',frozenAt:'2026-10-20T12:00:00Z',eventStart:'2026-10-20T23:00:00Z'};
const o={canonicalEventId:'evt1',canonicalPlayerId:'nhl:nhl:8478402',canonical_market:'shots_on_goal',
 period:'full_game',actual:4,official:true,source:'NHL_GAMECENTER_BOXSCORE',
 status:'FINAL',playerStatus:'PLAYED',correctionPending:false,finalizedAt:'2026-10-21T02:00:00Z'};
test('official outcome yields research error, not economic profit',()=>{
 const r=evaluateNhlProspectivePair(p,o,{now:Date.parse('2026-10-21T03:00:00Z')});
 assert.equal(r.ok,true);assert.equal(r.error,-.5);assert.equal(r.absoluteError,.5);
 assert.equal(evaluateNhlProspectivePair({...p,frozenAt:'2026-10-21T00:00:00Z'},o,{now:Date.parse('2026-10-21T03:00:00Z')}).ok,false);
 assert.equal(evaluateNhlProspectivePair(p,{...o,official:false},{now:Date.parse('2026-10-21T03:00:00Z')}).ok,false);
});
test('hashed R2 evidence calculates cohort MAE/RMSE without fabricating win rate',async()=>{
 const memory=new Map(),env={ARCHIVE:{get:async k=>memory.has(k)?{json:async()=>JSON.parse(memory.get(k)),text:async()=>memory.get(k)}:null,
 put:async(k,v)=>memory.set(k,v)}};
 const now=new Date('2026-10-21T03:00:00Z');
 const pred=await persistPropEvidence(env,{schemaVersion:1,kind:'FROZEN_PROJECTION',observedAt:p.frozenAt,
  canonicalEventId:p.canonicalEventId,canonicalPlayerId:p.canonicalPlayerId,sourceId:'fbis:model:nhl-v1',prediction:p},{webCrypto:webcrypto});
 const result=await persistPropEvidence(env,{schemaVersion:1,kind:'OFFICIAL_RESULT',observedAt:o.finalizedAt,
  canonicalEventId:o.canonicalEventId,canonicalPlayerId:o.canonicalPlayerId,sourceId:'nhl:boxscore:2026020001',result:o},{webCrypto:webcrypto});
 assert.equal(pred.ok,true);assert.equal(result.ok,true);
 memory.set('player-props/evidence/v1/prospective-index.json',JSON.stringify({version:1,entries:[
  {kind:'FROZEN_PROJECTION',id:pred.id,canonicalEventId:p.canonicalEventId,
   canonicalPlayerId:p.canonicalPlayerId,market:p.canonical_market,modelVersion:p.modelVersion,asOf:p.frozenAt}]}));
 memory.set('player-props/official/v1/nhl-outcome-index.json',JSON.stringify({
  'evt1|nhl:nhl:8478402|shots_on_goal':{id:result.id,actual:4}}));
 const r=await computeNhlProspectiveLearning(env,{now,webCrypto:webcrypto});
 assert.equal(r.ok,true);assert.equal(r.verifiedPairs,1);assert.equal(r.cohorts[0].mae,.5);
 assert.equal(r.cohorts[0].rmse,.5);assert.equal(r.realizedProfit,null);assert.equal(r.canAuthorizeWager,false);
});
