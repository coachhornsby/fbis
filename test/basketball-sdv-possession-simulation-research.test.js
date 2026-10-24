import test from "node:test";
import assert from "node:assert/strict";
import {BASKETBALL_POSSESSION_RESEARCH,validateBasketballPossessionGame,
 simulateBasketballPossessions} from "../functions/lib/basketballSdvPossessionSimulationResearch.js";
function fixture(sport,i,{home="A",away="B",season=2026,observedAt=null}={}){
 const nba=sport==="nba",per=nba?96:70,periods=nba?4:2;
 const start=new Date(Date.UTC(2026,9,1+i,16)).toISOString();
 const obs=observedAt||new Date(Date.parse(start)+5*3600000).toISOString();
 let homeScore=0,awayScore=0;
 const possessions=[];
 for(let j=0;j<per;j++){
  for(const offense of ["home","away"]){
   const points=(j+i+(offense==="home"?1:2))%5===0?3:(j+i)%3===0?2:0;
   if(offense==="home")homeScore+=points;else awayScore+=points;
   possessions.push({id:"poss"+j+offense,sequence:j*2+(offense==="home"?1:2),
    period:Math.min(periods,1+Math.floor(j/(per/periods))),offense,points});
  }
 }
 return {sport,gameId:sport+"-"+i+"-"+home+"-"+away,
  homeTeamId:home,awayTeamId:away,tipoff:start,observedAt:obs,
  season,regulationOnly:true,canAuthorizeWager:false,
  sourceFingerprint:(i+1).toString(16).padStart(64,"0"),
  homeRegulationScore:homeScore,awayRegulationScore:awayScore,possessions};
}
for(const sport of ["nba","cbb"]){
 test(sport+" verifies independent league clocks, exact sources and deterministic forecast",()=>{
  const history=Array.from({length:16},(_,i)=>fixture(sport,i,
    {home:i%2?"A":"B",away:i%2?"B":"A",season:2026}));
  for(const game of history){
   const valid=validateBasketballPossessionGame(game);
   assert.equal(valid.homeRegulationScore,game.homeRegulationScore);
   assert.equal(valid.awayRegulationScore,game.awayRegulationScore);
  }
  const req={sport,eventId:"next-"+sport,homeTeamId:"A",awayTeamId:"B",
   season:2026,tipoff:"2026-11-02T20:00:00Z",
   frozenAt:"2026-10-28T19:00:00Z",iterations:150,history};
  const a=simulateBasketballPossessions(req),b=simulateBasketballPossessions(req);
  assert.deepEqual(a.distributions,b.distributions);
  assert.equal(a.regulationMinutes,sport==="nba"?48:40);
  assert.equal(a.modelId,BASKETBALL_POSSESSION_RESEARCH[sport].id);
  assert.equal(a.simulatedPaths,150);
  assert.ok(a.distributions.home>0);
  assert.ok(a.distributions.regulationTie>=0);
  assert.ok(Math.abs(a.distributions.homeRegulationWin+a.distributions.awayRegulationWin+a.distributions.regulationTie-1)<1e-10);
  assert.equal(a.canQualify,false);
  assert.equal(a.canAuthorizeWager,false);
 });
 test(sport+" never trains on late source arrivals or unplayed games",()=>{
  const history=Array.from({length:16},(_,i)=>fixture(sport,i,
   {home:i%2?"A":"B",away:i%2?"B":"A",season:2026}));
  const excluded=history.map(x=>({...x,observedAt:"2026-11-03T00:00:00Z"}));
  assert.throws(()=>simulateBasketballPossessions({
   sport,eventId:"upcoming",homeTeamId:"A",awayTeamId:"B",
   season:2026,tipoff:"2026-11-02T20:00:00Z",
   frozenAt:"2026-10-28T19:00:00Z",history:excluded
  }),/BASKETBALL_TEAM_HISTORY_INSUFFICIENT/);
 });
 test(sport+" rejects invented score or bad possession/OT evidence",()=>{
  const source=fixture(sport,1);
  assert.throws(()=>validateBasketballPossessionGame({...source,homeRegulationScore:source.homeRegulationScore+2}),/FINAL_OR_PACE_MISMATCH/);
  assert.throws(()=>validateBasketballPossessionGame({...source,regulationOnly:false}),/UNVERIFIED/);
  assert.throws(()=>validateBasketballPossessionGame({...source,possessions:[...source.possessions,{id:"overtime",sequence:999,period:5,offense:"home",points:2}]}),/INVALID_BASKETBALL_POSSESSION_SEQUENCE/);
  assert.throws(()=>validateBasketballPossessionGame({...source,canAuthorizeWager:true}),/UNVERIFIED/);
 });
}
test("CBB must have three verified same-season games for each team",()=>{
 const old=Array.from({length:16},(_,i)=>fixture("cbb",i,{season:2025}));
 assert.throws(()=>simulateBasketballPossessions({
  sport:"cbb",eventId:"upcoming",homeTeamId:"A",awayTeamId:"B",
  season:2026,tipoff:"2026-11-02T20:00:00Z",
  frozenAt:"2026-10-28T19:00:00Z",history:old
 }),/CBB_CURRENT_SEASON_ROSTER_ERA_UNVERIFIED/);
});
test("Target game itself, regardless of finalized data, cannot enter its training set",()=>{
 const history=Array.from({length:16},(_,i)=>fixture("nba",i,
 {home:i%2?"A":"B",away:i%2?"B":"A"}));
 const item={...history[0],gameId:"target",tipoff:"2026-10-01T16:00:00Z"};
 assert.throws(()=>simulateBasketballPossessions({
  sport:"nba",eventId:"target",homeTeamId:"A",awayTeamId:"B",season:2026,
  tipoff:"2026-11-02T20:00:00Z",frozenAt:"2026-10-28T19:00:00Z",
  history:[...history,item]
 }),/DUPLICATE_BASKETBALL_SOURCE_GAME|BASKETBALL_TEAM_HISTORY_INSUFFICIENT/);
});
