import test from "node:test";
import assert from "node:assert/strict";

import {
  TENNIS_MATCH_MODEL_ID,
  TENNIS_PLAYER_MODEL_ID,
  estimateServePointWin,
  holdProbability,
  simulateTennisMatch,
  tennisPlayerProjectionRows,
  attachTennisProjectionResearch,
} from "../functions/lib/tennisFbisV1.js";
import {
  tennisTemporalEligible,
  scoreTennisForecast,
  evaluateTennisWalkForward,
} from "../functions/lib/tennisBacktest.js";
import {
  canonicalizeProPlayerPropMarket,
  PRO_PLAYER_PROP_MARKETS,
} from "../functions/lib/proPlayerProps.js";
import { curatedMarketsForSport } from "../functions/lib/propMarketPolicy.js";

const strong={
  id:"a",name:"Strong Server",elo:1820,hardElo:1860,
  servePointWinPct:.67,returnPointWinPct:.40,aceRate:.105,doubleFaultRate:.026,
};
const weak={
  id:"b",name:"Weak Return",elo:1610,hardElo:1580,
  servePointWinPct:.60,returnPointWinPct:.34,aceRate:.045,doubleFaultRate:.042,
};

test("serve-point matchup is directional and bounded",()=>{
  const a=estimateServePointWin(strong,weak,{surface:"hard"});
  const b=estimateServePointWin(weak,strong,{surface:"hard"});
  assert.ok(a>b);
  assert.ok(a<.8&&a>.5);
  assert.ok(b<.8&&b>.45);
});

test("game hold probability is monotonic",()=>{
  assert.ok(holdProbability(.70)>holdProbability(.64));
  assert.ok(holdProbability(.64)>holdProbability(.58));
  assert.ok(holdProbability(.64)>0&&holdProbability(.64)<1);
});

test("tennis simulation produces coherent independent match probabilities",()=>{
  const p=simulateTennisMatch({
    id:"test-match-1",surface:"hard",bestOf:3,player1:strong,player2:weak
  },{simulations:5000});
  assert.equal(p.ok,true);
  assert.equal(p.modelId,TENNIS_MATCH_MODEL_ID);
  assert.equal(p.independent,true);
  assert.equal(p.marketInformed,false);
  assert.equal(p.canQualify,false);
  assert.equal(p.canAuthorizeWager,false);
  assert.ok(Math.abs(p.match.pPlayer1Win+p.match.pPlayer2Win-1)<1e-9);
  assert.ok(p.match.pPlayer1Win>.5);
  assert.ok(p.match.totalGames.mean>=12);
  assert.ok(p.match.totalSets.mean>=2&&p.match.totalSets.mean<=3);
  assert.ok(p.playerMetrics[0].aces.mean>p.playerMetrics[1].aces.mean);
});

test("same seed is deterministic",()=>{
  const game={id:"seeded",surface:"clay",bestOf:3,player1:strong,player2:weak};
  const a=simulateTennisMatch(game,{simulations:2500},{seed:99});
  const b=simulateTennisMatch(game,{simulations:2500},{seed:99});
  assert.deepEqual(a.match,b.match);
  assert.deepEqual(a.playerMetrics,b.playerMetrics);
});

test("best-of-five expands the match length distribution",()=>{
  const bo3=simulateTennisMatch({id:"bo3",bestOf:3,player1:strong,player2:weak},{simulations:3000});
  const bo5=simulateTennisMatch({id:"bo5",bestOf:5,player1:strong,player2:weak},{simulations:3000});
  assert.ok(bo5.match.totalSets.mean>bo3.match.totalSets.mean);
  assert.ok(bo5.match.totalGames.mean>bo3.match.totalGames.mean);
});

test("player prop rows cover PrizePicks tennis model markets and stay research gated",()=>{
  const game={id:"props",surface:"hard",bestOf:3,player1:strong,player2:weak};
  const p=simulateTennisMatch(game,{simulations:3000});
  const rows=tennisPlayerProjectionRows(game,p,[
    {playerId:"a",market:"aces",line:7.5},
    {playerId:"a",market:"total_games_won",line:12.5},
  ]);
  const markets=new Set(rows.map(x=>x.market));
  for(const m of ["total_games","total_games_won","total_sets","aces","break_points_won","fantasy_score","total_tie_breaks","double_faults"]){
    assert.ok(markets.has(m),m);
  }
  assert.ok(rows.every(x=>x.modelId===TENNIS_PLAYER_MODEL_ID));
  assert.ok(rows.every(x=>x.canQualify===false&&x.canAuthorizeWager===false&&x.decisionEligible===false));
  const ace=rows.find(x=>x.playerId==="a"&&x.market==="aces");
  assert.ok(ace.probabilityOver>=0&&ace.probabilityOver<=1);
  assert.ok(ace.probabilityUnder>=0&&ace.probabilityUnder<=1);
});

test("attachment emits match + player research layers",()=>{
  const out=attachTennisProjectionResearch([{id:"g",player1:strong,player2:weak}],{simulations:1500});
  assert.equal(out.games.length,1);
  assert.ok(out.games[0].tennisV1.ok);
  assert.equal(out.games[0].playerProjectionRows.length,16);
  assert.equal(out.meta.canQualify,false);
});

test("canonical PrizePicks tennis markets normalize",()=>{
  const pairs={
    "Total Games":"total_games",
    "Games Won":"total_games_won",
    "Total Sets":"total_sets",
    "Aces":"aces",
    "Break Points Won":"break_points_won",
    "Fantasy Score":"fantasy_score",
    "Total Tie Breaks":"total_tie_breaks",
    "Double Faults":"double_faults",
  };
  for(const [raw,expected] of Object.entries(pairs)){
    assert.equal(canonicalizeProPlayerPropMarket("tennis",raw),expected,raw);
    assert.ok(PRO_PLAYER_PROP_MARKETS.tennis.includes(expected));
  }
  const curated=curatedMarketsForSport("tennis");
  for(const raw of Object.keys(pairs)) assert.ok(curated.includes(raw),raw);
});

test("walk-forward evaluator rejects post-start leakage and fails closed below sample gate",()=>{
  const pre={
    id:"x",start:"2026-09-01T15:00:00Z",frozenAt:"2026-09-01T14:59:00Z",
    actualWinner:0,actualTotalGames:21,pPlayer1Win:.68,projectedTotalGames:22.5,
  };
  assert.equal(tennisTemporalEligible(pre),true);
  assert.equal(tennisTemporalEligible({...pre,frozenAt:"2026-09-01T15:00:01Z"}),false);
  const s=scoreTennisForecast(pre);
  assert.equal(s.ok,true);
  assert.ok(s.brier>=0);
  assert.equal(s.totalGamesAbsError,1.5);
  const rows=Array.from({length:100},(_,i)=>({...pre,id:String(i)}));
  const evald=evaluateTennisWalkForward(rows,{minimumN:500});
  assert.equal(evald.metrics.n,100);
  assert.equal(evald.promotion.pass,false);
  assert.equal(evald.promotion.decision,"RESEARCH_ONLY");
});
