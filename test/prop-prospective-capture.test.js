import test from 'node:test';import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {prospectivePropEnvelope,captureProspectivePropResearch} from '../functions/lib/propProspectiveCapture.js';
const row={independent:true,marketInformed:false,identityVerified:true,canonicalEventId:'g1',canonicalPlayerId:'nhl:nhl:8478402',
 canonical_market:'shots_on_goal',period:'full_game',start_time:'2026-10-20T23:00:00Z',
 modelAsOf:'2026-10-20T15:00:00Z',modelId:'nhl-model',modelVersion:'1',fbis_projection:2.5};
test('pre-game independent model can be frozen with separate capture and feature clocks',()=>{
 const r=prospectivePropEnvelope(row,{observedAt:'2026-10-20T17:00:00Z'});
 assert.equal(r.ok,true);assert.equal(r.payload.prediction.frozenAt,'2026-10-20T17:00:00Z');assert.equal(r.payload.canAuthorizeWager,false);
});
test('no lookahead, unknown feature clock, market-informed or unversioned model can be frozen',()=>{
 for(const bad of [{...row,modelAsOf:null},{...row,marketInformed:true},{...row,modelVersion:null},{...row,modelAsOf:'2026-10-21T00:00:00Z'}])
  assert.equal(prospectivePropEnvelope(bad,{observedAt:'2026-10-20T17:00:00Z'}).ok,false);
 assert.equal(prospectivePropEnvelope(row,{observedAt:'2026-10-21T00:00:00Z'}).ok,false);
});
test('R2 stores the frozen model evidence with verified readback and no bet authority',async()=>{
 const m=new Map(),env={ARCHIVE:{get:async k=>m.has(k)?{text:async()=>m.get(k)}:null,put:async(k,v)=>m.set(k,v)}};
 const r=await captureProspectivePropResearch(env,[row],{now:new Date('2026-10-20T17:00:00Z'),webCrypto:webcrypto});
 assert.equal(r.ok,true);assert.equal(r.stored,1);assert.equal(r.canAuthorizeWager,false);
});
