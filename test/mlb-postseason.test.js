import test from "node:test";
import assert from "node:assert/strict";

import {
  attachMlbPostseasonContext,
  isMlbPostseasonGame,
  postseasonRound,
  MLB_POSTSEASON_CONTEXT_VERSION,
} from "../functions/lib/mlbPostseasonContext.js";
import { projectMlbDeep, MLB_DEEP_VERSION } from "../functions/lib/mlbDeepModel.js";

test("MLB postseason game types are detected without treating regular season as postseason", () => {
  assert.equal(isMlbPostseasonGame({ gameType: "R" }), false);
  assert.equal(isMlbPostseasonGame({ gameType: "F" }), true);
  assert.equal(isMlbPostseasonGame({ gameType: "D" }), true);
  assert.equal(isMlbPostseasonGame({ gameType: "L" }), true);
  assert.equal(isMlbPostseasonGame({ gameType: "W" }), true);
  assert.equal(postseasonRound({ gameType: "F" }), "WILD_CARD");
  assert.equal(postseasonRound({ gameType: "D" }), "DIVISION_SERIES");
  assert.equal(postseasonRound({ gameType: "L" }), "LEAGUE_CHAMPIONSHIP");
  assert.equal(postseasonRound({ gameType: "W" }), "WORLD_SERIES");
});

test("postseason attachment replaces bullpen and starter usage context only for postseason games", () => {
  const regular = { id:"r", sport:"mlb", gameType:"R", mlbContext:{homeBullpenEra:4.1,awayBullpenEra:4.2} };
  const playoff = { id:"p", sport:"mlb", gameType:"D", mlbContext:{homeBullpenEra:4.1,awayBullpenEra:4.2} };
  const feed = {
    byGameId:{
      p:{
        version:MLB_POSTSEASON_CONTEXT_VERSION,
        postseason:true,
        round:"DIVISION_SERIES",
        home:{bullpenEra:3.25,coreBullpenEra:3.1,expectedStarterInnings:5.8,bullpenFatigue:{fatigueScore:0.35}},
        away:{bullpenEra:3.55,coreBullpenEra:3.4,expectedStarterInnings:5.1,bullpenFatigue:{fatigueScore:0.8}},
      },
    },
  };
  const [r,p]=attachMlbPostseasonContext([regular,playoff],feed);
  assert.equal(r.mlbContext.homeBullpenEra,4.1);
  assert.equal(r.mlbPostseason,undefined);
  assert.equal(p.mlbContext.postseason,true);
  assert.equal(p.mlbContext.homeBullpenEra,3.25);
  assert.equal(p.mlbContext.awayBullpenEra,3.55);
  assert.equal(p.mlbContext.homeStarterExpectedInnings,5.8);
  assert.equal(p.mlbContext.awayStarterExpectedInnings,5.1);
  assert.equal(p.mlbContext.awayBullpenFatigueScore,0.8);
});

test("MLB deep model consumes postseason starter workload and active-core bullpen context for F5 and Ks", () => {
  const p=projectMlbDeep({
    sport:"mlb",
    gameType:"D",
    home:{abbr:"HOU"},away:{abbr:"SEA"},
    homeSp:{id:1,name:"Home Starter"},awaySp:{id:2,name:"Away Starter"},
    savant:{
      homeRpg:4.6,awayRpg:4.4,
      homeSpEra:3.2,awaySpEra:3.8,
      homeSpKPer9:9.4,awaySpKPer9:8.6,
      homeSpInningsPerStart:5.4,awaySpInningsPerStart:5.2,
      homeSpBattersFacedPerInning:4.25,awaySpBattersFacedPerInning:4.2,
      homeOpponentKRate:0.23,awayOpponentKRate:0.22,leagueKRate:0.225,
    },
    mlbContext:{
      postseason:true,
      postseasonRound:"DIVISION_SERIES",
      postseasonContextVersion:MLB_POSTSEASON_CONTEXT_VERSION,
      homeBullpenEra:3.1,awayBullpenEra:3.35,
      homePostseasonCoreBullpenEra:3.0,awayPostseasonCoreBullpenEra:3.2,
      homeBullpenFatigueScore:0.25,awayBullpenFatigueScore:0.85,
      homeStarterExpectedInnings:6.0,awayStarterExpectedInnings:4.8,
    },
    mlbPitchMatchup:{
      awayOffense:{lineupKRate:0.25,coverage:0.8,whiffPerSwing:0.27,contactPerSwing:0.73,dynamicDifficulty:0.2,runFactor:0.97},
      homeOffense:{lineupKRate:0.22,coverage:0.8,whiffPerSwing:0.24,contactPerSwing:0.76,dynamicDifficulty:0.1,runFactor:1.02},
    },
  });
  assert.equal(p.ok,true);
  assert.equal(MLB_DEEP_VERSION,"research-v2.5-postseason-context");
  assert.equal(p.provenance.postseasonContext.round,"DIVISION_SERIES");
  assert.equal(p.pitcherKs.home.expectedInnings,6.0);
  assert.equal(p.pitcherKs.away.expectedInnings,4.8);
  assert.equal(p.decomposition.away.starterShare,6/9);
  assert.equal(p.decomposition.home.starterShare,4.8/9);
  assert.equal(p.provenance.postseasonContext.awayBullpenFatigueScore,0.85);
  assert.ok(Number.isFinite(p.f5.total));
});
