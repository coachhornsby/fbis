import test from "node:test";
import assert from "node:assert/strict";
import {outcomeMetrics,rankFootballDistribution,sortFootballRankings} from "../functions/lib/footballSimulationRankings.js";
import {simulateNflFullGameResearch} from "../functions/lib/nflFullGameSimulationResearch.js";
import {buildFootballRankings,loadFootballRankingGames,onRequestGet} from "../functions/api/football-simulation-rankings.js";

test("All winner, tie and 14+ blowout events share the exact original game scores",()=>{
 assert.deepEqual(outcomeMetrics(35,21),{
  home_regulation_lead:1,away_regulation_lead:0,regulation_tie:0,
  home_blowout_14:1,away_blowout_14:0});
 assert.deepEqual(outcomeMetrics(17,31),{
  home_regulation_lead:0,away_regulation_lead:1,regulation_tie:0,
  home_blowout_14:0,away_blowout_14:1});
 assert.equal(outcomeMetrics(21,21).regulation_tie,1);
 assert.equal(outcomeMetrics(21,8).home_blowout_14,0);
});
const d={
 home_score:{mean:27.26},away_score:{mean:16.96},
 home_regulation_lead:{mean:.783},away_regulation_lead:{mean:.197},
 regulation_tie:{mean:.020},home_blowout_14:{mean:.423},
 away_blowout_14:{mean:.05},
};
test("A ranked scoreboard agrees exactly on winner/loser/total/margin and preserves ties",()=>{
 const result=rankFootballDistribution({sport:"nfl",gameId:"A",kickoff:"2026-10-25T19:00Z",
  home:"Texans",away:"Giants",iterations:5000,modelVersion:"NFL-DRIVE-MC-SHADOW-v1",distributions:d});
 assert.equal(result.predictedScoreWinner,27.3);
 assert.equal(result.predictedScoreLoser,17);
 assert.equal(result.total,44.3);
 assert.equal(result.margin,10.3);
 assert.equal(result.winPct,78.3);
 assert.equal(result.blowoutPct,42.3);
 assert.equal(result.tiePct,2);
 assert.equal(result.canAuthorizeWager,false);
 assert.equal(result.probabilisticRankingType,"UNVALIDATED_RESEARCH_FREQUENCY");
});
test("Uncollected CFB blowout percentages stay null; ranked N/A last",()=>{
 const older=rankFootballDistribution({sport:"cfb",gameId:"old",iterations:1000,
  home:"Alabama",away:"Texas A&M",distributions:{home_score:{mean:26.2},
   away_score:{mean:24.1},home_regulation_lead:{mean:.511},regulation_tie:{mean:.041}}});
 assert.equal(older.blowoutPct,null);
 assert.equal(older.probabilityComplete,false);
 assert.equal(sortFootballRankings([older,{...older,id:"new",blowoutPct:30}],"blowoutPct")[0].id,"new");
});
test("NFL generator plays all possessions, 5000 independent regulation paths and is deterministic",()=>{
 const input={gameId:"2026-nfl-1",kickoff:"2026-10-27T00:00:00Z",
  sourceFrozenAt:"2026-10-23T12:00:00Z",projectedHome:27.3,projectedAway:17,
  iterations:5000};
 const a=simulateNflFullGameResearch(input),b=simulateNflFullGameResearch(input);
 assert.equal(a.iterations,5000);
 assert.equal(a.distributions.home_regulation_lead.n,5000);
 assert.equal(a.distributions.home_blowout_14.n,5000);
 assert.equal(a.distributions.home_score.mean,b.distributions.home_score.mean);
 assert.equal(a.distributions.total.mean,b.distributions.total.mean);
 assert.equal(a.distributions.home_drives.n,5000);
 assert.ok(a.distributions.home_drives.mean>=8&&a.distributions.home_drives.mean<=15);
 assert.equal(a.canAuthorizeWager,false);
 assert.equal(a.calibrationStatus,"NOT_VALIDATED");
 assert.equal(a.overtimeMode,"NOT_MODELED");
 assert.ok(Math.abs(a.distributions.home_score.mean-a.distributions.away_score.mean-
   a.distributions.margin.mean)<1e-8);
 assert.ok(Math.abs(a.distributions.home_regulation_lead.mean+
   a.distributions.away_regulation_lead.mean+
   a.distributions.regulation_tie.mean-1)<1e-9);
});
test("NFL refuses after-kickoff or missing projection evidence; never substitutes betting odds",()=>{
 const base={gameId:"a",kickoff:"2026-10-23T12:00Z",
  sourceFrozenAt:"2026-10-23T13:00Z",projectedHome:24,projectedAway:22};
 assert.throws(()=>simulateNflFullGameResearch(base),/INVALID_NFL_FROZEN_PREGAME_BASELINE/);
 assert.throws(()=>simulateNflFullGameResearch({...base,sourceFrozenAt:"2026-10-22T12:00Z",
  projectedHome:null}),/INVALID_NFL_FROZEN_PREGAME_BASELINE/);
});
test("NFL and CFB board uses only their correct dedicated D1 and never primary",async()=>{
 for(const sport of ["nfl","cfb"]){
  await assert.rejects(loadFootballRankingGames({
   DB:{prepare(){throw Error("WRONG_PRIMARY_DB")}},
  },{sport,now:"2026-10-23T12:00:00Z"}),/SPORT_DB_UNBOUND/);
 }
 const nfl={NFL_DB:{prepare(sql){assert.match(sql,/prediction_snapshots/);
  assert.match(sql,/model_version='v1.2'/);return{bind(...args){
   assert.equal(args[2],"2026-10-23T12:00:00Z");
   return{all:async()=>({results:[]})};}}}}};
 const r=await loadFootballRankingGames(nfl,{sport:"nfl",now:"2026-10-23T12:00:00Z"});
 assert.deepEqual(r.games,[]);
 const cfb={CFB_DB:{prepare(sql){assert.match(sql,/cfb_drive_shadow_runs/);
  assert.match(sql,/can_authorize_wager=0/);
  return{bind(){return{all:async()=>({results:[]})}}}}}};
 const p=await loadFootballRankingGames(cfb,{sport:"cfb",now:"2026-10-23T12:00:00Z"});
 assert.deepEqual(p.games,[]);
});
test("Unpriced public research endpoint refuses incorrect sport/window and never returns wagers",async()=>{
 const req=new Request("https://f.test/api/football-simulation-rankings?sport=nba");
 const bad=await onRequestGet({request:req,env:{}});
 assert.equal(bad.status,400);
 const good=new Request("https://f.test/api/football-simulation-rankings?sport=nfl");
 const result=await onRequestGet({request:good,env:{NFL_DB:{prepare(){return{
  bind(){return {all:async()=>({results:[]})}}}}}}});
 assert.equal(result.status,200);
 const body=await result.json();
 assert.equal(body.canAuthorizeWager,false);
 assert.equal(body.calibrated,false);
 assert.equal(body.displayed,0);
});
test("Legacy CFB runs permit exact complementary away regulation win frequency, not fake blowouts",()=>{
 const game={gameId:"c",kickoff:"2026-10-25T20:00Z",home:"Home",away:"Away",
   homeAbbr:"H",awayAbbr:"A",iterations:1000,baselineVersion:"CFB-DRIVE-STATE-SHADOW-v2",
   simulationFrozenAt:"2026-10-23T10:00Z",baselineJson:JSON.stringify({sourceFrozenAt:"2026-10-22T05:00Z"}),
   distributionsJson:JSON.stringify({home_score:{mean:21},away_score:{mean:25},
   home_regulation_lead:{mean:.3},regulation_tie:{mean:.025}})};
 const r=buildFootballRankings([game],{sport:"cfb",source:"CFB_DB"});
 assert.equal(r.cards.length,1);
 assert.equal(r.cards[0].winPct,67.5);
 assert.equal(r.cards[0].blowoutPct,null);
 assert.equal(r.cards[0].margin,4);
});
