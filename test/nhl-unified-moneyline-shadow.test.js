import test from "node:test";
import assert from "node:assert/strict";
import {
  auditNhlMoneylineProbability,projectNhlUnifiedMoneylineShadow,attachNhlUnifiedMoneylineShadow
} from "../functions/lib/nhlUnifiedMoneylineShadow.js";

function game(){
  return {
    id:"2026020001",sport:"nhl",start:"2026-10-11T01:00:00Z",
    home:{abbr:"BUF"},away:{abbr:"UTA"},
    nhlProV2:{
      ok:true,modelId:"NHL-PRO-v2",modelVersion:"research-v2.0-event-chain-gbdt",
      eventId:"2026020001",home:"BUF",away:"UTA",
      featureCutoffTimestamp:"2026-10-10T21:00:00Z",projHome:3.3,projAway:3.2,marketInformed:false,
      dataLineage:{asOf:"2026-10-10T21:00:00Z",marketInputsUsedForProjection:false},
      probability:{
        homeRegWin:.414,awayRegWin:.389,regulationTie:.197,
        rawHomeWinIncludingOt:.515,eloHead:.43,
        homeWinIncludingOt:.4989,awayWinIncludingOt:.5011,
      },
      layers:{distribution:{family:"BIVARIATE_POISSON"}},
      winnerHead:{ok:true,modelId:"NHL-WIN-v1",modelVersion:"directional",
        classifierScore:.60,pickSide:"HOME",pick:"BUF"}
    },
    nhlGoalieProbabilityShadow:{
      ok:true,modelId:"NHL-GOALIE-PROB-SHADOW-v1",mode:"SHADOW",marketInformed:false,
      incumbent:{homeWinProbability:.4989,projHome:3.3,projAway:3.2},
      challenger:{homeWinProbability:.48},
      starterEvidence:{home:{state:"PROJECTED"},away:{state:"CONFIRMED"}}
    }
  };
}
test("three-head shadow exposes each independent input without inventing ensemble weights",()=>{
  const g=game(),p=projectNhlUnifiedMoneylineShadow(g);
  assert.equal(p.ok,true);
  assert.equal(p.components.proV2.incumbentHomeProbability,.4989);
  assert.equal(p.components.winV1.classifierScore,.60);
  assert.equal(p.components.goalieShadow.homeProbability,.48);
  assert.equal(p.candidate.homeWinProbability,null);
  assert.equal(p.candidate.calibrationStatus,"NO_VALIDATED_THREE_HEAD_FIT");
  assert.equal(p.marketScope,"FULL_GAME_INCLUDING_OT_SHOOTOUT");
  assert.equal(p.canQualify,false);
  assert.equal(p.canAuthorizeWager,false);
  assert.equal(p.projectionChanged,false);
});
test("out-of-time validated research coefficients can compute shadow-only triple logits",()=>{
  const fit={status:"VALIDATED_OUT_OF_TIME",marketInformed:false,marketScope:"FULL_GAME_INCLUDING_OT_SHOOTOUT",
    trainingEnd:"2025-06-01",testStart:"2025-10-01",testGames:1200,version:"test-fit",
    coefficients:[0,.5,.3,.2]};
  const x=projectNhlUnifiedMoneylineShadow(game(),fit);
  assert.ok(x.candidate.homeWinProbability>0&&x.candidate.homeWinProbability<1);
  assert.equal(x.candidate.calibrationStatus,"RESEARCH_FIT_ONLY");
  assert.equal(x.canQualify,false);
  assert.equal(x.canAuthorizeWager,false);
  const old=projectNhlUnifiedMoneylineShadow(game(),{...fit,testGames:20});
  assert.equal(old.candidate.homeWinProbability,null);
});
test("home/away event mismatch, stale cutoffs, and noncomplementary probabilities fail closed",()=>{
  const a=game();a.nhlProV2.eventId="other";
  assert.ok(auditNhlMoneylineProbability(a).reasons.includes("PROJECTION_EVENT_MISMATCH"));
  const b=game();b.nhlProV2.home="UTA";
  assert.ok(auditNhlMoneylineProbability(b).reasons.includes("HOME_AWAY_IDENTITY_MISMATCH"));
  const c=game();c.nhlProV2.featureCutoffTimestamp="2026-10-11T02:00:00Z";
  assert.ok(auditNhlMoneylineProbability(c).reasons.includes("PIT_CUTOFF_NOT_VERIFIED"));
  const d=game();d.nhlProV2.probability.awayWinIncludingOt=.8;
  assert.ok(auditNhlMoneylineProbability(d).reasons.includes("INVALID_FULL_GAME_PROBABILITY"));
  const e=game();e.nhlProV2.probability.regulationTie=.5;
  assert.ok(auditNhlMoneylineProbability(e).reasons.includes("INVALID_REGULATION_DISTRIBUTION"));
});
test("missing component, goalie/projection misalignment, and partial probability fail closed",()=>{
  const g=game();g.nhlGoalieProbabilityShadow.incumbent.homeWinProbability=.1;
  assert.ok(projectNhlUnifiedMoneylineShadow(g).reasons.includes("GOALIE_SHADOW_INCUMBENT_MISMATCH"));
  const h=game();h.nhlProV2.winnerHead=null;
  assert.ok(projectNhlUnifiedMoneylineShadow(h).reasons.includes("DIRECTIONAL_HEAD_UNAVAILABLE"));
  const k=game();k.nhlProV2.probability.homeWinIncludingOt=NaN;
  assert.ok(auditNhlMoneylineProbability(k).reasons.includes("INVALID_FULL_GAME_PROBABILITY"));
});
test("attach leaves unrelated sports and incumbent projection unchanged",()=>{
  const g=game(),before=JSON.stringify(g.nhlProV2);
  const nba={sport:"nba",id:"nba-1"};
  const out=attachNhlUnifiedMoneylineShadow([g,nba]);
  assert.equal(out.meta.complete,1);
  assert.equal(out.meta.incomplete,0);
  assert.equal(out.games[1],nba);
  assert.equal(JSON.stringify(out.games[0].nhlProV2),before);
});
