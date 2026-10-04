import test from "node:test";
import assert from "node:assert/strict";
import { nhlPlayerProV2RowsForSide, NHL_PLAYER_PRO_V2_ID } from "../functions/lib/nhlPlayerProV2.js";
import { attachNhlPlayerProjectionResearch } from "../functions/lib/proPlayerProjectionLayer.js";
import { normalizeBoardGame } from "../src/features/playerProps/buildPlayerPropsBoard.js";
import { NHL_PLAYER_PRO_V2_ARTIFACT } from "../data/models/nhl-player-pro-v2.js";
import { getModel } from "../functions/lib/canonical/modelRegistry.js";
import { normalizeNhlPlayerEdge, aggregateNhlTrackingMatchup } from "../functions/lib/nhlPlayerTrackingV3.js";
import { buildNhlOpportunityGame, opportunityForPlayer } from "../functions/lib/nhlOpportunityV4.js";

function fixture(){
  const game={
    id:"nhl-prop-test",sport:"nhl",start:"2026-10-10T00:00:00Z",
    home:{abbr:"BOS"},away:{abbr:"WPG"},
    odds:{total:6.5,homeML:-145},
    nhlProV2:{
      projHome:3.35,projAway:2.65,
      layers:{
        situation:{homeRestDays:2,awayRestDays:0},
        goalie:{
          home:{goalieId:"10",name:"BOS G",status:"CURRENT"},
          away:{goalieId:"20",name:"WPG G",status:"CURRENT"},
        },
      },
    },
    nhlV1:{layers:{goalie:{home:{goalieId:"10",name:"BOS G",status:"CURRENT"},away:{goalieId:"20",name:"WPG G",status:"CURRENT"}}}},
  };
  const ctx={
    teams:{
      BOS:{gfpg:3.2,shotsFor:31.2,shotsAgainst:29.1},
      WPG:{gfpg:3.0,shotsFor:29.4,shotsAgainst:31.0},
    },
    skatersByTeam:{
      BOS:[
        {id:"1",name:"A",position:"C",shotsPerGame:3.8,goalsPerGame:.42,assistsPerGame:.60,pointsPerGame:1.02},
        {id:"2",name:"B",position:"W",shotsPerGame:3.0,goalsPerGame:.30,assistsPerGame:.42,pointsPerGame:.72},
        {id:"3",name:"C",position:"D",shotsPerGame:2.1,goalsPerGame:.12,assistsPerGame:.38,pointsPerGame:.50},
      ],
      WPG:[
        {id:"4",name:"D",position:"C",shotsPerGame:3.4,goalsPerGame:.36,assistsPerGame:.50,pointsPerGame:.86},
        {id:"5",name:"E",position:"D",shotsPerGame:2.0,goalsPerGame:.10,assistsPerGame:.32,pointsPerGame:.42},
      ],
    },
    currentGoalies:[
      {id:"10",name:"BOS G",teams:["BOS"],starts:5,savePct:.914},
      {id:"20",name:"WPG G",teams:["WPG"],starts:6,savePct:.907},
    ],
    priorGoalies:[],
  };
  return {game,ctx};
}

test("NHL-PLAYER-PRO-v2 emits all supported NHL research markets",()=>{
  const {game,ctx}=fixture();
  const rows=nhlPlayerProV2RowsForSide(game,"home",ctx);
  const markets=new Set(rows.map(r=>r.market));
  for(const market of ["shots_on_goal","goals","assists","points","saves"]) assert.equal(markets.has(market),true);
  for(const r of rows){assert.ok(Number.isFinite(r.projection));assert.ok(r.sigma>0);}
});

test("NHL player projections are independent of sportsbook line/price",()=>{
  const {game,ctx}=fixture();
  const a=nhlPlayerProV2RowsForSide({...game,odds:{total:5.5,homeML:-110}},"home",ctx);
  const b=nhlPlayerProV2RowsForSide({...game,odds:{total:7.5,homeML:-250}},"home",ctx);
  assert.deepEqual(a.map(r=>[r.player.id,r.market,r.projection]),b.map(r=>[r.player.id,r.market,r.projection]));
});

test("NHL player prop layer publishes v2 identity and stays research-only",()=>{
  const {game,ctx}=fixture();
  const [out]=attachNhlPlayerProjectionResearch([game],ctx);
  assert.equal(out.playerProjectionStatus.model,NHL_PLAYER_PRO_V2_ID);
  assert.ok(out.playerProjectionRows.length>=5);
  assert.equal(out.playerProjectionStatus.canQualify,false);
  for(const r of out.playerProjectionRows){assert.equal(r.marketInformed,false);assert.equal(r.canAuthorizeWager,false);}
});

test("back-to-back rest suppresses skater volume without changing market inputs",()=>{
  const {game,ctx}=fixture();
  const rested=nhlPlayerProV2RowsForSide(game,"home",ctx).find(r=>r.player.id==="3"&&r.market==="shots_on_goal");
  const b2bGame={...game,nhlProV2:{...game.nhlProV2,layers:{...game.nhlProV2.layers,situation:{homeRestDays:0,awayRestDays:2}}}};
  const b2b=nhlPlayerProV2RowsForSide(b2bGame,"home",ctx).find(r=>r.player.id==="3"&&r.market==="shots_on_goal");
  assert.ok(b2b.projection<rested.projection);
});

test("NHL prop card eligibility is line-specific when a validation grid exists",()=>{
  const game=normalizeBoardGame({
    sport:"nhl",
    playerProjectionRows:[{
      playerId:"1",playerName:"A",team:"BOS",position:"C",market:"shots_on_goal",
      fbisProjection:3.1,fbisSigma:1.2,source:"NHL_PLAYER_PRO_V2_SHARE_ENVIRONMENT",
      maturity:"RESEARCH",independent:true,availabilityStatus:"ACTIVE",propGate:"CLEAR",
      eligibleForCard:true,validationStatus:"PROMOTE_RESEARCH",
      validatedLines:{"2.5":"PROMOTE_RESEARCH","5.5":"HOLD_RESEARCH"}
    }],
    playerMarkets:[
      {playerName:"A",team:"BOS",market:"shots_on_goal",marketCanonical:"shots_on_goal",line:2.5,book:"Heritage"},
      {playerName:"A",team:"BOS",market:"shots_on_goal",marketCanonical:"shots_on_goal",line:5.5,book:"Heritage"}
    ]
  });
  const good=game.playerMarkets.find(x=>x.line===2.5);
  const hold=game.playerMarkets.find(x=>x.line===5.5);
  assert.equal(good.lineValidationStatus,"PROMOTE_RESEARCH");
  assert.equal(good.eligibleForCard,true);
  assert.equal(hold.lineValidationStatus,"HOLD_RESEARCH");
  assert.equal(hold.eligibleForCard,false);
  assert.equal(hold.gateReason,"prop_line_not_validated_vs_baseline");
});

test("persisted NHL player-pro artifact enforces validated markets and lines",()=>{
  assert.equal(NHL_PLAYER_PRO_V2_ARTIFACT.trained,true);
  assert.equal(NHL_PLAYER_PRO_V2_ARTIFACT.training.games,3936);
  assert.equal(NHL_PLAYER_PRO_V2_ARTIFACT.training.boxscoreErrors,0);
  assert.equal(NHL_PLAYER_PRO_V2_ARTIFACT.validation.markets.shots_on_goal.status,"PROMOTE_RESEARCH");
  assert.equal(NHL_PLAYER_PRO_V2_ARTIFACT.validation.markets.saves.status,"PROMOTE_RESEARCH");
  assert.equal(NHL_PLAYER_PRO_V2_ARTIFACT.validation.markets.goals.status,"HOLD_RESEARCH");
  assert.equal(NHL_PLAYER_PRO_V2_ARTIFACT.validation.markets.points.status,"HOLD_RESEARCH");
  assert.equal(NHL_PLAYER_PRO_V2_ARTIFACT.validation.lines["shots_on_goal:2.5"].status,"PROMOTE_RESEARCH");
  assert.equal(NHL_PLAYER_PRO_V2_ARTIFACT.validation.lines["shots_on_goal:0.5"].status,"WATCH_RESEARCH");
  assert.equal(NHL_PLAYER_PRO_V2_ARTIFACT.validation.lines["saves:25.5"].status,"PROMOTE_RESEARCH");
  assert.equal(NHL_PLAYER_PRO_V2_ARTIFACT.validation.lines["saves:28.5"].status,"WATCH_RESEARCH");
});

test("NHL-PLAYER-PRO-v2 registry remains independent research with no wager authority",()=>{
  const model=getModel("NHL-PLAYER-PRO-v2");
  assert.ok(model);
  assert.equal(model.family,"PLAYER");
  assert.equal(model.marketInformed,false);
  assert.equal(model.independent,true);
  assert.equal(model.canQualify,false);
  assert.equal(model.canAuthorizeWager,false);
});


test("NHL player EDGE parser normalizes live tracking metrics without granting authority",()=>{
  const x=normalizeNhlPlayerEdge({
    skating:{maxSkatingSpeed:23.4,bursts22Plus:8,totalDistance:3.9},
    shot:{maxShotSpeed:97.1,avgShotSpeed:82.6,highDangerShots:11,slotShots:17},
    zone:{offensiveZonePct:0.381}
  });
  assert.equal(x.available,true);
  assert.equal(x.maxSkatingSpeed,23.4);
  assert.equal(x.maxShotSpeed,97.1);
  assert.ok(x.coverage>0);
});

test("NHL tracking matchup is advisory and does not alter v2 projections",()=>{
  const {game,ctx}=fixture();
  const edge={
    byPlayer:{
      "1":{available:true,maxSkatingSpeed:23,bursts22Plus:7,maxShotSpeed:96,highDangerShots:10,slotShots:14,offensiveZonePct:.38},
      "2":{available:true,maxSkatingSpeed:22,bursts22Plus:5,maxShotSpeed:94,highDangerShots:8,slotShots:12,offensiveZonePct:.36},
      "4":{available:true,maxSkatingSpeed:21,bursts22Plus:4,maxShotSpeed:93,highDangerShots:7,slotShots:10,offensiveZonePct:.34}
    }
  };
  const enriched={...ctx,playerEdge:edge};
  const m=aggregateNhlTrackingMatchup("BOS","WPG",ctx,edge);
  assert.equal(m.researchOnly,true);
  assert.ok(m.team.coverage>0);
  const a=nhlPlayerProV2RowsForSide(game,"home",ctx).map(r=>[r.player.id,r.market,r.projection]);
  const b=nhlPlayerProV2RowsForSide(game,"home",enriched).map(r=>[r.player.id,r.market,r.projection]);
  assert.deepEqual(a,b);
  assert.ok(nhlPlayerProV2RowsForSide(game,"home",enriched).some(r=>r.trackingAdvisory));
});


test("NHL opportunity v4 removes scratches and redistributes role to active players",()=>{
  const {game,ctx}=fixture();
  ctx.skatersByTeam.BOS[0].toiPerGame=1200;
  ctx.skatersByTeam.BOS[0].powerPlayToiPerGame=210;
  ctx.skatersByTeam.BOS[1].toiPerGame=1050;
  ctx.skatersByTeam.BOS[1].powerPlayToiPerGame=150;
  ctx.schedule=[{id:"2026029999",home:"BOS",away:"WPG",start:game.start}];
  const pbp={rosterSpots:[
    {playerId:"1",firstName:{default:"A"},lastName:{default:"One"},positionCode:"C"},
    {playerId:"2",firstName:{default:"B"},lastName:{default:"Two"},positionCode:"L"},
    {playerId:"3",firstName:{default:"C"},lastName:{default:"Three"},positionCode:"D"},
    {playerId:"4",firstName:{default:"D"},lastName:{default:"Four"},positionCode:"C"},
    {playerId:"5",firstName:{default:"E"},lastName:{default:"Five"},positionCode:"D"},
  ]};
  const box={boxscore:{scratches:{homeTeam:[{playerId:"1"}],awayTeam:[]}}};
  const opp=buildNhlOpportunityGame(game,ctx,{pbp,box});
  assert.equal(opp.available,true);
  assert.equal(opp.home.scratched[0].playerId,"1");
  const inherited=opportunityForPlayer(opp,"home","2");
  assert.equal(inherited.scratched,false);
  assert.ok(inherited.toiMultiplier>1);
  assert.ok(inherited.shotMultiplier>1);
  const scratch=opportunityForPlayer(opp,"home","1");
  assert.equal(scratch.scratched,true);
});

test("NHL player projection excludes confirmed scratches and increases an inheritor",()=>{
  const {game,ctx}=fixture();
  ctx.schedule=[{id:"2026029999",home:"BOS",away:"WPG",start:game.start}];
  const baseRows=nhlPlayerProV2RowsForSide(game,"home",ctx);
  const baseB=baseRows.find(r=>r.player.id==="2"&&r.market==="shots_on_goal");
  const opp=buildNhlOpportunityGame(game,ctx,{
    pbp:{rosterSpots:[{playerId:"1"},{playerId:"2"},{playerId:"3"},{playerId:"4"},{playerId:"5"}]},
    box:{boxscore:{scratches:{homeTeam:[{playerId:"1"}],awayTeam:[]}}}
  });
  const enriched={...ctx,opportunity:{byGame:{[game.id]:opp}}};
  const rows=nhlPlayerProV2RowsForSide(game,"home",enriched);
  assert.equal(rows.some(r=>r.player.id==="1"),false);
  const boosted=rows.find(r=>r.player.id==="2"&&r.market==="shots_on_goal");
  assert.ok(boosted.projection>baseB.projection);
  assert.ok(boosted.opportunityAdjustment);
});
