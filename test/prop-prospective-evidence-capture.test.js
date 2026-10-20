import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {prospectivePropPayload,captureProspectivePropEvidence} from '../functions/lib/propProspectiveEvidenceCapture.js';
const now=new Date('2026-10-20T12:00:00Z');
const model={canonicalEventId:'evt',canonicalPlayerId:'nhl:nhl:8478402',canonical_market:'shots_on_goal',
 period:'full_game',start_time:'2026-10-20T23:00:00Z',independent:true,marketInformed:false,
 fbis_projection:3.4,modelVersion:'nhl-m1',modelAsOf:'2026-10-20T11:00:00Z'};
const market={...model,provider:'Kalshi',contractId:'KXNHL-test',collectedAt:'2026-10-20T11:40:00Z',
 identityVerified:true,line:2.5,statSide:'over',side:'yes',settlementTerms:'example'};
test('freeze independent model before game with verifiable clocks',()=>{
 const x=prospectivePropPayload(model,'FROZEN_PROJECTION',now);
 assert.equal(x.prediction.projection,3.4);assert.equal(x.prediction.frozenAt,now.toISOString());
 assert.equal(x.canAuthorizeWager,undefined);
 for(const bad of [{...model,modelAsOf:'2026-10-20T13:00:00Z'},{...model,independent:false},
  {...model,marketInformed:true},{...model,modelVersion:null},{...model,start_time:'2026-10-20T10:00:00Z'}])
 assert.equal(prospectivePropPayload(bad,'FROZEN_PROJECTION',now),null);
});
test('market observations cannot silently become executable quotes or certified settlement',()=>{
 const p=prospectivePropPayload(market,'MARKET_SNAPSHOT',now);
 assert.equal(p.purchaseAsk,null);assert.equal(p.settlementPolicyVerified,false);assert.equal(p.quoteSourceObservedAt,null);
 assert.equal(prospectivePropPayload({...market,collectedAt:'2026-10-20T23:10:00Z'},'MARKET_SNAPSHOT',now),null);
});
test('immutable captures are indexed and repeat runs are idempotent',async()=>{
 const map=new Map(),env={ARCHIVE:{get:async k=>map.has(k)?{json:async()=>JSON.parse(map.get(k)),text:async()=>map.get(k)}:null,
  put:async(k,v)=>map.set(k,v)}};
 const a=await captureProspectivePropEvidence(env,{projections:[model],markets:[market],now,webCrypto:webcrypto});
 assert.equal(a.ok,true);assert.equal(a.captured,2);assert.equal(a.canAuthorizeWager,false);
 const b=await captureProspectivePropEvidence(env,{projections:[model],markets:[market],now,webCrypto:webcrypto});
 assert.equal(b.ok,true);assert.equal(b.captured,0);assert.equal(b.indexSize,2);
});
