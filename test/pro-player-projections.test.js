import test from "node:test";
import assert from "node:assert/strict";

import {
  attachMlbPlayerProjectionResearch,
  attachNflPlayerProjectionResearch,
  attachNhlPlayerProjectionResearch,
  attachNbaPlayerProjectionBlocked,
} from "../functions/lib/proPlayerProjectionLayer.js";
import { aggregateNextGen, aggregateSnapCounts } from "../functions/lib/nflVerseFeed.js";
import { selectivePropStars, rankSelectiveProps } from "../functions/lib/selectivePropEdge.js";
import { aggregateNextGen, aggregateSnapCounts } from "../functions/lib/nflVerseFeed.js";

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


test("NFL Next Gen aggregator extracts passing, rushing, receiving tracking signals", () => {
  const out = aggregateNextGen({
    passing:[{season:2026,week:1,team_abbr:"KC",player_gsis_id:"qb1",player_display_name:"QB One",attempts:30,avg_time_to_throw:2.5,aggressiveness:12,completion_percentage_above_expectation:4.2}],
    rushing:[{season:2026,week:1,team_abbr:"KC",player_gsis_id:"rb1",player_display_name:"RB One",attempts:15,rush_yards_over_expected_per_att:0.8,efficiency:3.2}],
    receiving:[{season:2026,week:1,team_abbr:"KC",player_gsis_id:"wr1",player_display_name:"WR One",targets:8,avg_separation:3.4,avg_yac:5.8,avg_expected_yac:4.6}],
  },2026);
  assert.equal(out.teamFeatures.KC.qbNgsCpoe,4.2);
  assert.equal(out.teamFeatures.KC.rushYoePerAtt,0.8);
  assert.equal(out.teamFeatures.KC.receivingSeparation,3.4);
  assert.ok(out.teamFeatures.KC.receivingYacOe > 1);
});

test("NFL snap aggregator converts percentage fields to role share", () => {
  const out = aggregateSnapCounts([
    {season:2026,week:1,team:"KC",player_id:"wr1",player:"WR One",offense_pct:82,offense_snaps:55},
    {season:2026,week:2,team:"KC",player_id:"wr1",player:"WR One",offense_pct:78,offense_snaps:52},
  ],2026);
  assert.equal(out.KC[0].snapShare,0.8);
  assert.equal(out.KC[0].games,2);
});

test("NFL player v2 uses snap-role and NGS evidence without market-line input", () => {
  const feed={byTeam:{
    KC:[{id:"wr1",name:"WR One",position:"WR",games:4,receiving_yards:70,receptions:5,targets:8,snapShare:0.82,
      ngs:{avgSeparation:3.5,yacOverExpected:1.1},sd:{receiving_yards:25}}],
    LV:[]
  }};
  const [g]=attachNflPlayerProjectionResearch([{id:"nfl-v2",home:{abbr:"KC"},away:{abbr:"LV"},researchProjection:{home:27,away:20}}],feed);
  const row=g.playerProjectionRows.find(r=>r.playerName==="WR One"&&r.market==="receiving_yards");
  assert.ok(row);
  assert.equal(row.source,"NFLVERSE_WEEKLY_PLUS_NGS_SNAP_V2");
  assert.equal(row.marketInformed,false);
  assert.ok(row.fbisProjection > 70);
  assert.ok(row.roleConfidence > 0.8);
  assert.equal(row.featureEvidence.nextGen,true);
  assert.equal(row.featureEvidence.snapShare,true);
});


test("NFL v2 player layer uses snap share and Next Gen efficiency without market input", () => {
  const feed={byTeam:{
    KC:[{
      id:"wr1",name:"WR One",position:"WR",receiving_yards:70,receptions:5.2,targets:8,
      snapShare:0.90,trackingGames:5,snapGames:5,
      ngs:{avgSeparation:3.5,yacOverExpected:1.2},
      sd:{receiving_yards:24,receptions:1.8}
    }],
    LV:[]
  }};
  const [g]=attachNflPlayerProjectionResearch([{
    id:"nfl-v2",home:{abbr:"KC"},away:{abbr:"LV"},researchProjection:{home:27,away:20}
  }],feed);
  const rec=g.playerProjectionRows.find(r=>r.market==="receiving_yards");
  assert.ok(rec);
  assert.equal(g.playerProjectionStatus.model,"NFL-PLAYER-PROJ-v2");
  assert.equal(rec.marketInformed,false);
  assert.equal(rec.featureEvidence.nextGen,true);
  assert.equal(rec.featureEvidence.snapShare,true);
  assert.ok(rec.snapVolumeFactor > 1);
  assert.ok(rec.fbisProjection > 70);
});

test("NFL v2 prop selection fails closed on weak role or missing sigma", () => {
  const weak={
    sport:"nfl",playerName:"WR Weak",eventId:"e1",fbisProjection:78,line:65,
    fbisSigma:20,roleConfidence:0.4,dataQuality:0.9,propGate:"CLEAR",eligibleForCard:true
  };
  assert.ok(selectivePropStars(weak) <= 2);

  const noSigma={
    sport:"nfl",playerName:"WR NoSigma",eventId:"e2",fbisProjection:82,line:65,
    roleConfidence:0.9,dataQuality:0.9,propGate:"CLEAR",eligibleForCard:true
  };
  assert.ok(selectivePropStars(noSigma) <= 2);

  const strong={
    sport:"nfl",playerName:"WR Strong",eventId:"e3",fbisProjection:86,line:65,
    fbisSigma:18,roleConfidence:0.9,dataQuality:0.9,propGate:"CLEAR",eligibleForCard:true,
    featureEvidence:{nextGen:true,snapShare:true}
  };
  assert.ok(selectivePropStars(strong) >= 4);
  const ranked=rankSelectiveProps([weak,noSigma,strong]);
  assert.equal(ranked.rows.length,1);
  assert.equal(ranked.rows[0].playerName,"WR Strong");
  assert.equal(ranked.policy.minStars,3);
});

test("nflverse v2 aggregates Next Gen and snap-share evidence", () => {
  const ngs=aggregateNextGen({
    passing:[{season:2026,week:1,team_abbr:"KC",player_gsis_id:"qb1",player_display_name:"QB One",avg_time_to_throw:"2.6",completion_percentage_above_expectation:"4.2",aggressiveness:"12"}],
    rushing:[{season:2026,week:1,team_abbr:"KC",player_gsis_id:"rb1",player_display_name:"RB One",rush_yards_over_expected_per_att:"0.7",efficiency:"3.2"}],
    receiving:[{season:2026,week:1,team_abbr:"KC",player_gsis_id:"wr1",player_display_name:"WR One",avg_separation:"3.4",avg_yac_above_expectation:"1.1"}],
  },2026);
  assert.equal(ngs.teamFeatures.KC.qbTimeToThrow,2.6);
  assert.equal(ngs.teamFeatures.KC.rushYoePerAtt,0.7);
  assert.equal(ngs.teamFeatures.KC.receivingSeparation,3.4);

  const snaps=aggregateSnapCounts([
    {season:2026,week:1,team:"KC",player_id:"wr1",player:"WR One",offense_pct:"90"},
    {season:2026,week:2,team:"KC",player_id:"wr1",player:"WR One",offense_pct:"80"},
  ],2026);
  assert.equal(Number(snaps.KC[0].snapShare.toFixed(2)),0.85);
});
