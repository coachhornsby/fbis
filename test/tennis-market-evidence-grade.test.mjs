import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateTennisMarketEvidence as grade} from '../functions/lib/tennisMarketEvidenceGrade.js';
const event={id:'e1',tour:'atp',startAt:'2026-10-24T14:00:00Z',player1Id:'p1',player2Id:'p2'};
const forecast={id:'f1',eventId:'e1',createdAt:'2026-10-24T10:00:00Z',p1:.6};
const quote=(observedAt,decimalOdds)=>({eventId:'e1',venue:'kalshi',contractId:'c1',
 playerId:'p1',observedAt,decimalOdds,verifiedSource:true,
 marketType:'MATCH_WINNER',executable:true});
test('paired independently captured quotes produce transparent CLV and unit return',()=>{
 const result=grade({forecast,event,winnerId:'p1',fees:.02,quotes:[
  quote('2026-10-24T09:00:00Z',2.2),quote('2026-10-24T13:50:00Z',2.0)]});
 assert.equal(result.ok,true);
 assert.ok(result.clvImpliedProbability>0);
 assert.ok(Math.abs(result.unitReturn-1.18)<1e-9);
 assert.equal(result.canAuthorizeWager,false);
});
test('rejects post-start entry, wrong event, hindsight and absent independent close',()=>{
 const quotes=[quote('2026-10-24T09:00:00Z',2.2),quote('2026-10-24T13:50:00Z',2.0)];
 assert.equal(grade({forecast,event,winnerId:'p1',quotes:[quotes[0]]}).ok,false);
 assert.equal(grade({forecast:{...forecast,createdAt:event.startAt},event,winnerId:'p1',quotes}).ok,false);
 assert.equal(grade({forecast,event,winnerId:'wrong',quotes}).ok,false);
 assert.equal(grade({forecast,event,winnerId:'p1',quotes:[{...quotes[0],verifiedSource:false},quotes[1]]}).ok,false);
});
