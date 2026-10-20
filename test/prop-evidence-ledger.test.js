import test from 'node:test';
import assert from 'node:assert/strict';
import {freezePropEvidence,reconcilePropEvidence} from '../functions/lib/propEvidenceLedger.js';
const prediction={canonicalEventId:'e',canonicalPlayerId:'p',canonical_market:'goals',period:'game',modelVersion:'m',asOf:'2026-10-20T10:00:00Z',projection:1.5};
const contract={canonicalEventId:'e',canonicalPlayerId:'p',canonical_market:'goals',period:'game',provider:'Kalshi',contractId:'c',eventStart:'2026-10-20T22:00:00Z'};
test('frozen prospective evidence has reproducible content ID and cannot authorize a wager',()=>{
 const a=freezePropEvidence({prediction,contract,observedAt:'2026-10-20T11:00:00Z'});
 const b=freezePropEvidence({prediction,contract,observedAt:'2026-10-20T11:00:00Z'});
 assert.equal(a.ok,true);assert.equal(a.id,b.id);assert.equal(a.canAuthorizeWager,false);
 assert.equal(reconcilePropEvidence([a],[b]).records.length,1);
});
test('post-start, backdated data, mismatched identity, and mutation fail closed',()=>{
 for(const p of [{...prediction,asOf:'2026-10-20T12:00:00Z'},{...prediction,canonicalPlayerId:'wrong'}]){
  assert.equal(freezePropEvidence({prediction:p,contract,observedAt:'2026-10-20T11:00:00Z'}).ok,false);
 }
 assert.equal(freezePropEvidence({prediction,contract,observedAt:'2026-10-20T23:00:00Z'}).ok,false);
 const good=freezePropEvidence({prediction,contract,observedAt:'2026-10-20T11:00:00Z'});
 assert.equal(reconcilePropEvidence([],[{...good,payload:{...good.payload,observedAt:'changed'}}]).ok,false);
});
