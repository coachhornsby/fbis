import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";


import {
  evaluateNflQbProspectiveGate,
  nflQbProspectiveCriteria,
} from "../functions/lib/nflProspectiveGate.js";
import {
  buildNflQbPersonnelShadow,
  executableNflMarketSnapshot,
} from "../functions/lib/nflQbPersonnelShadow.js";

test("portable QB personnel fit mirrors the frozen canonical JSON", async () => {
  const canonical=JSON.parse(readFileSync(new URL("../data/models/nfl-qb-personnel-overlay-v1-fit.json",import.meta.url),"utf8"));
  const { default: fit } = await import("../functions/lib/nflQbPersonnelFit.js");
  assert.deepEqual(fit,canonical);
});

test("Cloudflare-compatible criteria mirror matches the canonical immutable JSON artifact", () => {
  const canonical=JSON.parse(readFileSync(new URL("../data/models/nfl-qb-prospective-promotion-gate-v1.json",import.meta.url),"utf8"));
  assert.deepEqual(nflQbProspectiveCriteria(),canonical);
});

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
    home_profile_json:"{}",away_profile_json:"{}",provenance_json:JSON.stringify({prospectiveGateId:"NFL-QB-PROSPECTIVE-GATE-v1",governanceId:"FBIS-STATE-OVERLAY-v1"}),
    incumbent_total:44,challenger_total:45,incumbent_margin:3,challenger_margin:3,
    incumbent_win_probability:.6,challenger_win_probability:.6,gate_fired:0,
  };
  const r=evaluateNflQbProspectiveGate([row]);
  assert.ok(r.integrity.temporalViolations.length>=1);
  assert.equal(r.integrity.totalMismatches,1);
  assert.equal(r.checks.temporalIntegrity,false);
  assert.equal(r.checks.totalsExact,false);
});


test("pre-gate legacy rows are excluded without being mutated",()=>{
  const legacy={
    event_id:"legacy",checkpoint:"EARLY",frozen_at:"2026-10-06T03:25:27.083Z",
    incumbent_total:43.4,challenger_total:43.4,
    incumbent_margin:7,challenger_margin:7,
    incumbent_win_probability:.6685919067,challenger_win_probability:.7306815685,
    gate_fired:0,
    provenance_json:JSON.stringify({source:"FBIS_PROSPECTIVE_SHADOW"}),
  };
  const r=evaluateNflQbProspectiveGate([legacy]);
  assert.equal(r.sample.eligibleFrozenRows,0);
  assert.equal(r.sample.excludedPreGateOrWrongVersionRows,1);
  assert.equal(r.integrity.gateOffMismatches,0);
  assert.equal(r.checks.gateOffExact,true);
});

test("versioned post-gate rows enter the cohort and enforce gate-off equality",()=>{
  const row={
    event_id:"g2",checkpoint:"EARLY@NFL-QB-PROSPECTIVE-GATE-v1",frozen_at:"2026-10-06T04:30:00Z",
    incumbent_total:43.4,challenger_total:43.4,
    incumbent_margin:7,challenger_margin:7,
    incumbent_win_probability:.6685919067,challenger_win_probability:.6685919067,
    gate_fired:0,
    provenance_json:JSON.stringify({prospectiveGateId:"NFL-QB-PROSPECTIVE-GATE-v1",governanceId:"FBIS-STATE-OVERLAY-v1"}),
  };
  const r=evaluateNflQbProspectiveGate([row]);
  assert.equal(r.sample.eligibleFrozenRows,1);
  assert.equal(r.integrity.gateOffMismatches,0);
  assert.equal(r.checks.gateOffExact,true);
});


test("confirmed official NFL QB1 OUT is surfaced but cannot modify a score or wager authority",async()=>{
  const {nflInjuryScoreIntegrity}=await import("../src/lib/nflInjuryScoreIntegrity.js");
  const home={abbr:"ATL"},away={abbr:"BAL"};
  const originalScore={home:22.6,away:24.3};
  const game={sport:"nfl",home,away,nflProShadow:{...originalScore,margin:-1.7,total:46.9},
    nflPersistentProfile:{configured:true,home:{players:[]},away:{players:[
      {player_name:"Lamar Jackson",position:"QB",depth_rank:1,role_label:"QB1",health_state:"OUT",injury_detail:"Ankle",state_source:"nfl-official",state_source_updated_at:"2026-10-11T15:54:51.949Z"},
      {player_name:"Tyler Huntley",position:"QB",depth_rank:2,role_label:"QB2",health_state:"AVAILABLE",state_source:"roster-presence"}
    ]}}};
  const x=nflInjuryScoreIntegrity(game);
  assert.equal(x.kind,"CONFIRMED_QB_OUT");
  assert.equal(x.critical,true);
  assert.equal(x.confirmedQbOut[0].name,"Lamar Jackson");
  assert.equal(x.confirmedQbOut[0].replacement.name,"Tyler Huntley");
  assert.equal(x.scoreUsesPersistentInjuries,false);
  assert.equal(x.canQualify,false);
  assert.equal(x.canAuthorizeWager,false);
  assert.deepEqual(game.nflProShadow,{...originalScore,margin:-1.7,total:46.9});
});

test("NFL injury strip fails closed for missing state and does not infer injury from roster alone",async()=>{
  const {nflInjuryScoreIntegrity}=await import("../src/lib/nflInjuryScoreIntegrity.js");
  const absent=nflInjuryScoreIntegrity({sport:"nfl"});
  assert.equal(absent.kind,"NO_PERSONNEL_STATE");
  assert.equal(absent.scoreUsesPersistentInjuries,false);
  assert.equal(absent.canAuthorizeWager,false);
  const unverified=nflInjuryScoreIntegrity({sport:"nfl",home:{abbr:"BAL"},away:{abbr:"ATL"},nflPersistentProfile:{
    configured:true,home:{players:[{player_name:"Example",position:"QB",role_label:"QB1",health_state:"OUT",state_source:"roster-presence"}]},away:{players:[]}}});
  assert.equal(unverified.critical,false);
  assert.equal(unverified.confirmedQbOut.length,0);
  assert.equal(nflInjuryScoreIntegrity({sport:"cfb"}),null);
});

test("NFL game cards display official QB OUT warning without changing NFL projection calculation",async()=>{
  const fs=await import("node:fs");
  for(const path of ["src/components/board/CompactGameCard.jsx","src/components/board/PremiumGameCard.jsx"]){
    const content=fs.readFileSync(path,"utf8");
    assert.match(content,/<NflInjuryIntegrityStrip game=\{game\}/);
  }
  const view=fs.readFileSync("src/components/board/NflInjuryIntegrityStrip.jsx","utf8");
  assert.match(view,/RESEARCH SCORE NOT INJURY-ADJUSTED/);
  assert.match(view,/NFL official injury report/);
  assert.doesNotMatch(view,/api\/nfl-qb-shadow|\.prepare\s*\(|\bfetch\s*\(/);
});
