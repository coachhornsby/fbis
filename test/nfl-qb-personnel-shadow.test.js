import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNflQbPersonnelShadow,
  qbPersonnelBurdenFromGame,
  NFL_QB_PERSONNEL_GATE,
} from "../functions/lib/nflQbPersonnelShadow.js";

function baseGame(homePlayers=[],awayPlayers=[]){
  return {
    sport:"nfl",
    nflProShadow:{
      ok:true,modelId:"NFL-PRO-v1",version:"v1.2",
      home:24,away:21,margin:3,total:45,pHomeWin:.59,sigmaMargin:13.8,
    },
    nflPersistentProfile:{
      home:{team_key:"sf",players:homePlayers,updated_at:"2026-10-05T12:00:00Z"},
      away:{team_key:"sea",players:awayPlayers,updated_at:"2026-10-05T12:00:00Z"},
      configured:true,
    },
  };
}

test("NFL QB personnel gate stays closed when only non-QB injuries exist",()=>{
  const game=baseGame([
    {player_key:"sf_wr1",player_name:"WR",position:"WR",health_state:"OUT",last_known_snap_share:.92},
  ],[]);
  const burden=qbPersonnelBurdenFromGame(game);
  assert.equal(burden.combinedQbBurden,0);
  const out=buildNflQbPersonnelShadow(game);
  assert.equal(out.gate.fired,false);
  assert.equal(out.margin,3);
  assert.equal(out.total,45);
  assert.equal(out.home,24);
  assert.equal(out.away,21);
  assert.equal(out.invariants.challengerEqualsIncumbentWhenGateClosed,true);
  assert.equal(out.canQualify,false);
  assert.equal(out.canAuthorizeWager,false);
});

test("NFL QB personnel gate fires at validated 0.30 threshold and never changes total",()=>{
  const game=baseGame([
    {player_key:"sf_qb1",player_name:"QB1",position:"QB",health_state:"QUESTIONABLE",last_known_snap_share:.95},
    {player_key:"sf_qb2",player_name:"QB2",position:"QB",health_state:"AVAILABLE",last_known_snap_share:.10},
  ],[]);
  const out=buildNflQbPersonnelShadow(game);
  assert.equal(NFL_QB_PERSONNEL_GATE.threshold,.30);
  assert.equal(out.gate.fired,true);
  assert.ok(out.gate.combinedQbBurden>=.30);
  assert.equal(out.total,45);
  assert.equal(Number((out.home+out.away).toFixed(3)),45);
  assert.equal(out.invariants.genericInjuryAdjustmentApplied,false);
  assert.equal(out.invariants.productionChampionModified,false);
  assert.equal(out.invariants.wagerAuthorityModified,false);
  assert.equal(out.lifecycle,"SHADOW");
});

test("confirmed OUT QB produces larger burden than questionable QB at same snap role",()=>{
  const q={player_key:"q1",player_name:"QB1",position:"QB",last_known_snap_share:.90};
  const out1=qbPersonnelBurdenFromGame(baseGame([{...q,health_state:"QUESTIONABLE"}],[]));
  const out2=qbPersonnelBurdenFromGame(baseGame([{...q,health_state:"OUT"}],[]));
  assert.ok(out2.combinedQbBurden>out1.combinedQbBurden);
});
