import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateNflQbProspectiveGate,
  nflQbProspectiveCriteria,
} from "../functions/lib/nflProspectiveGate.js";
import {
  buildNflQbPersonnelShadow,
  executableNflMarketSnapshot,
} from "../functions/lib/nflQbPersonnelShadow.js";

test("frozen NFL prospective gate is conservative and never auto-promotes",()=>{
  const c=nflQbProspectiveCriteria();
  assert.equal(c.governanceId,"FBIS-STATE-OVERLAY-v1");
  assert.equal(c.gateId,"NFL-QB-PROSPECTIVE-GATE-v1");
  assert.ok(c.thresholds.minGateFiredGames>=50);
  assert.ok(c.thresholds.minDistinctSeasons>=2);
  assert.equal(c.autoPromote,false);
  assert.equal(c.operatorApprovalRequired,true);
  const r=evaluateNflQbProspectiveGate([]);
  assert.equal(r.researchGatePassed,false);
  assert.equal(r.automaticPromotion,false);
  assert.equal(r.operatorApprovalRequired,true);
  assert.equal(r.promotionEligible,false);
});

test("gate-off challenger preserves incumbent margin, total, and win probability exactly",()=>{
  const g={
    nflProShadow:{ok:true,modelId:"NFL-PRO-v1",version:"v1.2",home:24,away:21,margin:3,total:45,pHomeWin:.612345,sigmaMargin:13.8},
    nflPersistentProfile:{home:{players:[]},away:{players:[]}},
  };
  const out=buildNflQbPersonnelShadow(g);
  assert.equal(out.gate.fired,false);
  assert.equal(out.margin,3);
  assert.equal(out.total,45);
  assert.equal(out.pHomeWin,.612345);
  assert.equal(out.invariants.challengerEqualsIncumbentWhenGateClosed,true);
});

test("NFL market snapshot freezes moneyline and computes no-vig probability when both sides exist",()=>{
  const market=executableNflMarketSnapshot({
    market:{moneyline:{home:-150,away:130},observedAt:"2026-10-06T01:00:00Z"},
  });
  assert.equal(market.moneylineHome,-150);
  assert.equal(market.moneylineAway,130);
  assert.ok(market.noVigHomeProbability>0.5 && market.noVigHomeProbability<1);
  assert.ok(Math.abs((market.noVigHomeProbability+market.noVigAwayProbability)-1)<1e-9);
  assert.equal(market.observedAt,"2026-10-06T01:00:00Z");
});

test("prospective evaluator rejects temporal leakage and total mismatch",()=>{
  const row={
    event_id:"g1",checkpoint:"EARLY",frozen_at:"2026-10-06T10:00:00Z",
    executable_market_json:JSON.stringify({observedAt:"2026-10-06T10:05:00Z"}),
    home_profile_json:"{}",away_profile_json:"{}",provenance_json:"{}",
    incumbent_total:44,challenger_total:45,incumbent_margin:3,challenger_margin:3,
    incumbent_win_probability:.6,challenger_win_probability:.6,gate_fired:0,
  };
  const r=evaluateNflQbProspectiveGate([row]);
  assert.ok(r.integrity.temporalViolations.length>=1);
  assert.equal(r.integrity.totalMismatches,1);
  assert.equal(r.checks.temporalIntegrity,false);
  assert.equal(r.checks.totalsExact,false);
});
