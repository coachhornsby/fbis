import test from "node:test";
import assert from "node:assert/strict";

import {
  attachMlbPlayerProjectionResearch,
  attachNflPlayerProjectionResearch,
  attachNhlPlayerProjectionResearch,
  attachNbaPlayerProjectionBlocked,
} from "../functions/lib/proPlayerProjectionLayer.js";

test("MLB player layer exposes independent pitcher K projection", () => {
  const [g] = attachMlbPlayerProjectionResearch([{
    id:"mlb1",
    home:{abbr:"NYY"},
    away:{abbr:"BOS"},
    mlbDeepShadow:{pitcherKs:{
      home:{team:"NYY",playerId:1,playerName:"Home SP",projection:6.4},
      away:{team:"BOS",playerId:2,playerName:"Away SP",projection:5.1},
    }},
  }]);
  assert.equal(g.playerProjectionStatus.state,"ACTIVE_RESEARCH");
  assert.equal(g.playerProjectionRows.length,2);
  assert.equal(g.playerProjectionRows[0].market,"strikeouts");
  assert.equal(g.playerProjectionRows[0].marketInformed,false);
});

test("NFL player layer creates market-independent projections from nflverse baselines", () => {
  const feed={byTeam:{
    KC:[{id:"qb1",name:"QB One",position:"QB",passing_yards:280,attempts:35,completions:24,passing_tds:2.1,interceptions:0.7,rushing_yards:22,carries:4,sd:{passing_yards:55}}],
    LV:[{id:"wr1",name:"WR One",position:"WR",receiving_yards:71,receptions:5.4,targets:8.2,total_tds:0.45,sd:{receiving_yards:28}}],
  }};
  const [g]=attachNflPlayerProjectionResearch([{
    id:"nfl1",
    home:{abbr:"KC"},
    away:{abbr:"LV"},
    researchProjection:{home:28,away:20},
  }],feed);
  assert.equal(g.playerProjectionStatus.state,"ACTIVE_RESEARCH");
  assert.ok(g.playerProjectionRows.some(r=>r.market==="passing_yards"&&r.playerName==="QB One"));
  assert.ok(g.playerProjectionRows.some(r=>r.market==="receiving_yards"&&r.playerName==="WR One"));
  assert.ok(g.playerProjectionRows.every(r=>r.marketInformed===false));
});

test("NHL player layer projects skater rates and expected-goalie saves", () => {
  const ctx={
    teams:{TOR:{gfpg:3.4,shotsFor:32},BOS:{gfpg:3.1,shotsFor:30}},
    skatersByTeam:{
      TOR:[{id:"10",name:"Skater A",position:"C",shotsPerGame:3.2,pointsPerGame:1.1,goalsPerGame:0.5,assistsPerGame:0.6}],
      BOS:[{id:"20",name:"Skater B",position:"W",shotsPerGame:2.8,pointsPerGame:0.9,goalsPerGame:0.4,assistsPerGame:0.5}],
    }
  };
  const [g]=attachNhlPlayerProjectionResearch([{
    id:"nhl1",
    home:{abbr:"TOR"},
    away:{abbr:"BOS"},
    nhlV1:{
      home:3.6,away:2.9,
      layers:{goalie:{
        home:{goalieId:"g1",name:"Home G",savePct:0.915},
        away:{goalieId:"g2",name:"Away G",savePct:0.91},
      }}
    }
  }],ctx);
  assert.equal(g.playerProjectionStatus.state,"ACTIVE_RESEARCH");
  assert.ok(g.playerProjectionRows.some(r=>r.market==="shots_on_goal"));
  assert.ok(g.playerProjectionRows.some(r=>r.market==="saves"));
});

test("NBA player layer fails closed without rights-cleared player feed", () => {
  const [g]=attachNbaPlayerProjectionBlocked([{id:"nba1"}]);
  assert.equal(g.playerProjectionRows.length,0);
  assert.equal(g.playerProjectionStatus.state,"BLOCKED_RIGHTS_CLEARED_PLAYER_FEED");
  assert.equal(g.playerProjectionStatus.canQualify,false);
});


test("player prop layer blocks unavailable players and holds unresolved players", () => {
  const feed={byTeam:{
    KC:[
      {id:"qb1",name:"QB One",position:"QB",passing_yards:280,attempts:35,completions:24,sd:{passing_yards:55}},
      {id:"wr1",name:"WR One",position:"WR",receiving_yards:75,receptions:5.5,targets:8,sd:{receiving_yards:27}},
    ],
    LV:[]
  }};
  const [g]=attachNflPlayerProjectionResearch([{
    id:"nfl-gate",
    home:{abbr:"KC"},away:{abbr:"LV"},
    researchProjection:{home:27,away:20},
    availabilityImpact:{
      configured:true,stale:false,
      home:{players:[
        {playerId:"qb1",name:"QB One",status:"OUT"},
        {playerId:"wr1",name:"WR One",status:"QUESTIONABLE"},
      ]},
      away:{players:[]},
    }
  }],feed);
  const qb=g.playerProjectionRows.find(r=>r.playerId==="qb1");
  const wr=g.playerProjectionRows.find(r=>r.playerId==="wr1");
  assert.equal(qb.propGate,"BLOCKED");
  assert.equal(qb.eligibleForCard,false);
  assert.equal(wr.propGate,"HOLD");
  assert.equal(wr.eligibleForCard,false);
});
