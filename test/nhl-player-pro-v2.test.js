import test from "node:test";
import assert from "node:assert/strict";
import { nhlPlayerProV2RowsForSide, NHL_PLAYER_PRO_V2_ID } from "../functions/lib/nhlPlayerProV2.js";
import { attachNhlPlayerProjectionResearch } from "../functions/lib/proPlayerProjectionLayer.js";

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
