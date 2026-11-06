import test from "node:test";
import assert from "node:assert/strict";
import {buildFirstHalfEvidence} from "../functions/lib/cbbFirstHalfEmpiricalResearch.js";
const target={homeId:"A",awayId:"B",tipAt:"2026-11-06T23:00:00Z",venue:"Home"};
const rows=Array.from({length:9},(_,i)=>({
  gameId:"G"+i,tipAt:"2026-11-0"+(i%5+1)+"T20:00:00Z",
  capturedAt:"2026-11-05T20:00:00Z",homeId:i%2?"A":"B",awayId:"C",
  homeFirstHalfPoints:35,awayFirstHalfPoints:30,
  period:"1H",final:true,sourceVerified:true,season:2027
}));
test("first half baseline is independent and never authorizes wagers",()=>{
  const r=buildFirstHalfEvidence(rows,target,{minTeamGames:1,season:2027});
  assert.equal(r.ok,true);
  assert.equal(r.method,"independent_first_half");
  assert.equal(r.validated,false);
  assert.equal(r.canAuthorizeWager,false);
});
test("future scores cannot enter pregame evidence",()=>{
  const future={...rows[0],gameId:"F",tipAt:"2026-11-07T20:00:00Z"};
  const r=buildFirstHalfEvidence([...rows,future],target,{minTeamGames:1});
  assert.equal(r.rejected,1);
});
test("requires both teams to have own first-half records",()=>{
  const r=buildFirstHalfEvidence(rows,target,{minTeamGames:2});
  assert.equal(r.ok,false);
  assert.equal(r.reason,"INSUFFICIENT_1H_SAMPLES");
});
test("does not treat full-game totals as first-half scores",()=>{
  const bad={...rows[0],gameId:"X",period:"FULL",homeFirstHalfPoints:150};
  const r=buildFirstHalfEvidence([...rows,bad],target,{minTeamGames:1});
  assert.equal(r.rejected,1);
});
