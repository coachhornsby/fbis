import test from "node:test";
import assert from "node:assert/strict";

import { gameDistribution, estimateParkFactors, pitcherKProjection } from "../functions/lib/asianBaseballV2.js";
import { projectNpbV2Game, attachNpbFbisV2 } from "../functions/lib/npbFbisV2.js";
import { projectKboV2Game, attachKboFbisV2 } from "../functions/lib/kboFbisV2.js";
import { compareWalkForward, temporalEligible } from "../functions/lib/asianBaseballBacktest.js";

test("shared baseball distribution is normalized and directionally correct",()=>{
  const d=gameDistribution(5.2,3.8,{dispersion:9});
  assert.ok(d.pHomeWin>.5);
  assert.ok(d.pHomeMinus1_5>0);
  const sum=d.totalDistribution.reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(sum-1)<0.02);
});

test("park estimator shrinks small samples toward neutral",()=>{
  const hist=[
    {venue:"A",homeRuns:8,awayRuns:7},{venue:"A",homeRuns:7,awayRuns:6},
    {venue:"B",homeRuns:2,awayRuns:1},{venue:"B",homeRuns:3,awayRuns:2},
  ];
  const f=estimateParkFactors(hist,{shrinkGames:100});
  assert.ok(f.A>1);
  assert.ok(f.B<1);
  assert.ok(f.A<1.1);
});

test("pitcher K projection exposes a probability distribution",()=>{
  const p=pitcherKProjection({kPer9:9,ipPerGame:6},{kRate:.24},{kRate:.20});
  assert.ok(p.projection>6);
  assert.ok(Array.isArray(p.distribution));
  assert.ok(p.probabilityAtLeast(6)>.4);
});

test("NPB v2 produces independent full-game, F5 and K probabilities",()=>{
  const game={id:"NPB-X",venue:"甲子園",home:{abbr:"HAN"},away:{abbr:"YAK"},probableStarterIds:{home:"1",away:"2"}};
  const ctx={
    teams:{
      HAN:{runsPerGame:4.1,kRate:.19,bbRate:.09,hrRate:.025,staffEra:2.9},
      YAK:{runsPerGame:3.5,kRate:.23,bbRate:.08,hrRate:.021,staffEra:4.0},
    },
    pitchersByTeam:{
      HAN:[{playerId:"1",era:2.4,kPer9:9.2,bbPer9:2.1,ipPerGame:6.1,innings:140,games:23},{playerId:"11",era:3.2,kPer9:8.1,ipPerGame:1.1,innings:55,games:50}],
      YAK:[{playerId:"2",era:4.1,kPer9:7.6,bbPer9:3.0,ipPerGame:5.3,innings:120,games:23},{playerId:"22",era:4.5,kPer9:7.0,ipPerGame:1.0,innings:50,games:50}],
    },
  };
  const p=projectNpbV2Game(game,ctx);
  assert.equal(p.ok,true);
  assert.equal(p.marketInformed,false);
  assert.ok(p.probabilities.pHomeWin>0&&p.probabilities.pHomeWin<1);
  assert.ok(p.f5.probabilities.pHomeWin>0&&p.f5.probabilities.pHomeWin<1);
  assert.ok(p.pitcherKs.home.projection>0);
  const attached=attachNpbFbisV2([game],ctx).games[0];
  assert.equal(attached.model.maturity,"RESEARCH");
  assert.equal(attached.canQualify,false);
  assert.equal(attached.qualificationBlocked,true);
});

test("KBO v2 uses advanced team and official starter context",()=>{
  const game={id:"KBO-X",venue:"JAMSIL",home:{abbr:"DOOSAN"},away:{abbr:"NC"}};
  const ctx={
    teams:{
      DOOSAN:{games:136,pct:.519,runsPerGame:4.69,runsAllowedPerGame:4.35},
      NC:{games:135,pct:.49,runsPerGame:5.01,runsAllowedPerGame:5.05},
    },
    advancedTeams:{
      DOOSAN:{games:136,ops:.728,obp:.337,slg:.391,kRate:.177,bbRate:.085,era:3.81,whip:1.34,oppAvg:.253},
      NC:{games:135,ops:.751,obp:.349,slg:.402,kRate:.186,bbRate:.088,era:4.70,whip:1.42,oppAvg:.257},
    },
    pitchers:[
      {team:"DOOSAN",era:3.2,innings:50,games:48},{team:"NC",era:4.8,innings:54,games:50}
    ],
    startersByGame:{
      "KBO-X":{
        source:"KBO_GAMECENTER_START_PIT",
        home:{name:"D SP",team:"DOOSAN",era:2.73,kPer9:7.85,bbPer9:3.44,pitchesPerGame:91.4,pitchesPerInning:16.5,oppOps:.643},
        away:{name:"N SP",team:"NC",era:4.1,kPer9:7.39,bbPer9:2.68,pitchesPerGame:90.3,pitchesPerInning:16.1,oppOps:.747},
      }
    }
  };
  const p=projectKboV2Game(game,ctx);
  assert.equal(p.ok,true);
  assert.equal(p.dataState.advancedTeamStats,true);
  assert.equal(p.dataState.startersResolved,true);
  assert.ok(p.pitcherKs.home.projection>0);
  const attached=attachKboFbisV2([game],ctx).games[0];
  assert.equal(attached.modelVersion.startsWith("KBO-FBIS-v2@"),true);
  assert.equal(attached.canQualify,false);
});

test("walk-forward evaluator rejects post-start snapshots and keeps promotion fail-closed",()=>{
  const pre={start:"2026-10-01T10:00:00Z",frozenAt:"2026-10-01T09:00:00Z",homeRuns:5,awayRuns:3,v1:{home:4,away:4,pHome:.5},v2:{home:5,away:3,pHome:.65}};
  const post={...pre,frozenAt:"2026-10-01T11:00:00Z"};
  assert.equal(temporalEligible(pre),true);
  assert.equal(temporalEligible(post),false);
  const rows=Array.from({length:20},(_,i)=>({...pre,start:`2026-10-${String((i%20)+1).padStart(2,"0")}T10:00:00Z`,frozenAt:`2026-10-${String((i%20)+1).padStart(2,"0")}T09:00:00Z`}));
  const c=compareWalkForward(rows,{minimumN:500});
  assert.equal(c.promotion.pass,false);
  assert.equal(c.promotion.decision,"RESEARCH_ONLY");
});
