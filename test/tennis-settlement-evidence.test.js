import test from 'node:test';
import assert from 'node:assert/strict';
import { normalTennisFinish,evaluateTennisSettlement } from '../functions/lib/tennisSettlementEvidence.js';
const event={match_id:'wta_123',tour:'wta',source:'WTA_OFFICIAL',source_match_id:'2026|foo|123',player1_id:'wta:a',player2_id:'wta:b',winner_id:'wta:a',match_time:'2026-10-10T20:00:00Z',tournament_name:'Test Open',surface:'hard',completion_state:'FINAL',result_reason:'NORMAL',score_text:'6-4 7-6(4)'};
const proof={matchId:event.match_id,source:event.source,observedAt:'2026-10-10T17:00:00Z',player1Id:event.player1_id,player2Id:event.player2_id,startTime:event.match_time,tournament:event.tournament_name,surface:event.surface};
const decision={id:'d1',canonical_event_id:'tennis:action:abc',tour:'wta',player1:'Player A',player2:'Player B',decision_timestamp:'2026-10-10T18:00:00Z',event_start_time:event.match_time,pure_p1:.7,market_prior_p1:.55,model_edge:.15,context_json:JSON.stringify({eventProof:proof}),market_json:JSON.stringify({quotes:[{book:'pinnacle',p1Price:-125,p2Price:105,observedAt:'2026-10-10T17:55:00Z'}]})};
const close={id:'close1',canonical_event_id:decision.canonical_event_id,tour:'wta',player1:decision.player1,player2:decision.player2,market_type:'moneyline',player1_no_vig_prob:.60,observed_at:'2026-10-10T19:40:00Z',collected_at:'2026-10-10T19:41:00Z',snapshot_type:'CLOSING'};
const settle=(d=decision,e=event,c=[close])=>evaluateTennisSettlement(d,e,c);
test('valid official final with PIT evidence grades as research, but cannot authorize wagers',()=>{
 const g=settle();assert.equal(g.eligible,true);assert.equal(g.winnerP1,true);assert.equal(g.profitUnits,.8);assert.ok(Math.abs(g.clv-.05)<1e-9);assert.equal(g.marketEvidence,'close1');assert.equal(g.governance.canAuthorizeWager,false);
});
test('no synthetic official events, unlinked players or name-only settlement',()=>{
 for(const [e,reason] of [[{...event,source:'SACKMANN'},'OFFICIAL_RESULT_SOURCE_UNVERIFIED'],[{...event,source_match_id:null},'OFFICIAL_RESULT_IDENTITY_MISSING'],[{...event,match_id:'different'},'DECISION_EVENT_PROOF_MISMATCH'],[{...event,player1_id:'unknown'},'DECISION_EVENT_PROOF_MISMATCH'],[{...event,tournament_name:'Wrong Open'},'DECISION_EVENT_CONTEXT_MISMATCH'],[{...event,winner_id:'wrong'},'OFFICIAL_WINNER_UNVERIFIED']])assert.equal(settle(decision,e).reason,reason);
});
test('historical replay and future availability fail strict projection PIT proof',()=>{
 assert.equal(settle({...decision,context_json:JSON.stringify({eventProof:{...proof,observedAt:'2026-10-10T18:02:00Z'}})}).reason,'DECISION_PIT_PROOF_INVALID');
 assert.equal(settle({...decision,event_start_time:'2026-10-10T20:15:00Z'}).reason,'DECISION_PIT_PROOF_INVALID');
 assert.equal(settle({...decision,decision_timestamp:'2026-10-10T20:01:00Z'}).reason,'DECISION_PIT_PROOF_INVALID');
 assert.equal(settle({...decision,context_json:null}).reason,'DECISION_EVENT_PROOF_MISMATCH');
});
test('retirements, walkovers, incomplete scores, missing terminal semantics fail closed',()=>{
 for(const e of [{...event,score_text:'6-4 2-1 RET'},{...event,score_text:'W/O'},{...event,score_text:'6-4 3-1'},{...event,completion_state:'UNKNOWN'},{...event,result_reason:'UNKNOWN'},{...event,result_reason:'F'}]) {
   assert.equal(normalTennisFinish(e),false);assert.equal(settle(decision,e).reason,'RESULT_SETTLEMENT_UNVERIFIED');
 }
});
test('no matched prestart closing quote creates CLV; no entry quote creates no invented ROI',()=>{
 const late={...close,observed_at:'2026-10-10T20:01:00Z'};
 const collectedLate={...close,collected_at:'2026-10-10T20:02:00Z'};
 const wrongMarket={...close,market_type:'total'};
 const reversed={...close,player1:'Player B',player2:'Player A'};
 assert.equal(settle(decision,event,[late,collectedLate,wrongMarket,reversed]).clv,null);
 assert.equal(settle({...decision,market_json:JSON.stringify({quotes:[{book:'pinnacle',p1Price:-125,observedAt:'2026-10-10T18:01:00Z'}]})}).profitUnits,null);
 assert.equal(settle({...decision,market_json:null}).profitUnits,null);
});
test('losses and passes are distinguished; duplicate grading excluded by the writer',()=>{
 assert.equal(settle(decision,{...event,winner_id:'wta:b'}).profitUnits,-1);
 const d={...decision,model_edge:.005};const g=settle(d);assert.equal(g.selectedP1,null);assert.equal(g.profitUnits,null);assert.equal(g.clv,null);
});
