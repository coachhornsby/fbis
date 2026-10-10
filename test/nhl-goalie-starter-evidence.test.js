import test from "node:test";
import assert from "node:assert/strict";
import {resolveNhlGoalieStarterEvidence} from "../functions/lib/nhlGoalieStarterEvidence.js";
import {projectNhlGoalieProbabilityShadow} from "../functions/lib/nhlGoalieProbabilityShadow.js";

const event="game-2026-10-10";
const start="2026-10-10T23:00:00Z",cutoff="2026-10-10T21:00:00Z";
const baseProfile=()=>({
  teams:{bos:{next_game_id:event,next_game_start:start}},
  goalies:{bos:[{
    player_id:"11",team_key:"bos",goalie_state:"CONFIRMED_STARTER",
    confirmation_game_id:event,confirmation_source:"NHL_OFFICIAL_STARTER_ANNOUNCEMENT",
    confirmation_observed_at:"2026-10-10T18:00:00Z",source_updated_at:"2026-10-10T18:05:00Z",
    expected_start_probability:0.9
  }]}
});
function evidence(profiles,config={}) {
  return resolveNhlGoalieStarterEvidence(profiles,"BOS",{
    eventId:event,gameStart:start,cutoff,projectionGoalieId:"10",...config
  });
}
test("verified source-published, current-game confirmed starter supersedes historical proxy",()=>{
  const out=evidence(baseProfile());
  assert.equal(out.state,"CONFIRMED");
  assert.equal(out.playerId,"11");
  assert.equal(out.eventId,event);
  assert.equal(out.lineupMatched,false);
  assert.equal(out.expectedStartProbability,1);
});
test("a previous game's confirmation, after-cutoff refresh or stale announcement never becomes current-game confirmation",()=>{
  const cases=[
    row=>{row.confirmation_game_id="last-game";},
    row=>{row.confirmation_observed_at="2026-10-10T22:00:00Z";},
    row=>{row.source_updated_at="2026-10-10T22:00:00Z";},
    row=>{row.confirmation_observed_at="2026-10-08T18:00:00Z";},
    row=>{row.goalie_state="LAST_CONFIRMED_STARTER";},
    row=>{delete row.confirmation_source;},
    row=>{delete row.confirmation_observed_at;},
    row=>{row.team_key="wpg";}
  ];
  for(const mutate of cases){
    const p=baseProfile();mutate(p.goalies.bos[0]);
    const out=evidence(p);
    assert.equal(out.state,"HISTORICAL_PROXY_UNVERIFIED",JSON.stringify(p.goalies.bos[0]));
    assert.equal(out.playerId,"10");
    assert.equal(out.expectedStartProbability,null);
  }
});
test("EXPECTED_G1 is only a projected candidate when the next event and fresh source probability align",()=>{
  const p=baseProfile();
  p.goalies.bos[0].goalie_state="EXPECTED_G1";
  const good=evidence(p);
  assert.equal(good.state,"PROJECTED");
  assert.equal(good.expectedStartProbability,.9);
  assert.equal(good.lineupMatched,false);
  p.teams.bos.next_game_id="prior-game";
  assert.equal(evidence(p).state,"HISTORICAL_PROXY_UNVERIFIED");
  p.teams.bos.next_game_id=event;
  p.goalies.bos[0].source_updated_at="2026-10-07T20:00:00Z";
  assert.equal(evidence(p).state,"HISTORICAL_PROXY_UNVERIFIED");
  p.goalies.bos[0].source_updated_at="2026-10-10T18:05:00Z";
  p.goalies.bos[0].expected_start_probability=null;
  assert.equal(evidence(p).state,"HISTORICAL_PROXY_UNVERIFIED");
});
test("goalie shadow does not infer a new game's confirmation from last-game profile",()=>{
  const game={
    id:event,start,home:{abbr:"BOS"},away:{abbr:"WPG"},
    nhlProV2:{
      ok:true,home:"BOS",away:"WPG",gameStart:start,featureCutoffTimestamp:cutoff,
      projHome:3.2,projAway:2.9,probability:{homeWinIncludingOt:.55,eloHead:.53},
      layers:{goalie:{home:{goalieId:"10",impactPerShot:.005,reliability:.7},
        away:{goalieId:"20",impactPerShot:.004,reliability:.7}}}
    }
  };
  const p=baseProfile();
  p.goalies.bos[0].goalie_state="LAST_CONFIRMED_STARTER";
  const result=projectNhlGoalieProbabilityShadow(game,p);
  assert.equal(result.ok,true);
  assert.equal(result.starterEvidence.home.state,"HISTORICAL_PROXY_UNVERIFIED");
  assert.equal(result.starterEvidence.home.lineupMatched,null);
  assert.equal(result.canQualify,false);
});
