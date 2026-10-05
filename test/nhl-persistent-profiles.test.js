import test from "node:test";
import assert from "node:assert/strict";
import {
  NHL_PERSISTENT_PROFILE_ID,
  buildNhlScheduleProfile,
  attachNhlPersistentProfiles,
  haversineMiles,
  inferNhlSpecialTeamsUnits,
  parseNhlCoachMetadata,
  buildNhlDeploymentTendencies,
} from "../functions/lib/nhlPersistentProfiles.js";

function game({id,start,home,away,state="FUT",type=2}){
  return {id:String(id),start,home,away,state,gameType:type,venue:null,neutral:false,raw:{}};
}

test("NHL schedule profile derives B2B, 3-in-4, travel and road-trip state",()=>{
  const rows=buildNhlScheduleProfile([
    game({id:1,start:"2026-10-10T00:00:00Z",home:"BOS",away:"NYR"}),
    game({id:2,start:"2026-10-11T23:00:00Z",home:"BUF",away:"BOS"}),
    game({id:3,start:"2026-10-13T23:00:00Z",home:"PIT",away:"BOS"}),
    game({id:4,start:"2026-10-15T23:00:00Z",home:"WSH",away:"BOS"}),
  ],"BOS",20262027,Date.parse("2026-10-01T00:00:00Z"));
  assert.equal(rows.length,4);
  assert.equal(rows[1].site,"ROAD");
  assert.equal(rows[1].backToBack,false);
  assert.ok(rows[1].travelMiles>300);
  assert.equal(rows[2].threeInFour,true);
  assert.equal(rows[3].roadTripGameNumber,3);
  assert.ok(rows[2].scheduleStressScore>0);
});

test("NHL schedule profile canonicalizes LAK/NJD/SJS/TBL to product keys",()=>{
  const rows=buildNhlScheduleProfile([
    game({id:1,start:"2026-10-10T00:00:00Z",home:"LA",away:"NJ"}),
    game({id:2,start:"2026-10-12T00:00:00Z",home:"SJ",away:"LA"}),
  ],"LA",20262027);
  assert.equal(rows[0].teamKey,"la");
  assert.equal(rows[0].opponentKey,"nj");
  assert.equal(rows[1].opponentKey,"sj");
});

test("persistent profile attachment is market-free and research-only",()=>{
  const games=[{sport:"nhl",home:{abbr:"BOS"},away:{abbr:"WPG"}}];
  const profiles={
    teams:{bos:{team_key:"bos",schedule_stress_score:.2},wpg:{team_key:"wpg",schedule_stress_score:.7}},
    players:{bos:[{player_id:"1"}],wpg:[{player_id:"2"}]},
    goalies:{bos:[{player_id:"10"}],wpg:[{player_id:"20"}]},
    linemates:{bos:[],wpg:[]},
  };
  const [out]=attachNhlPersistentProfiles(games,profiles);
  assert.equal(out.nhlPersistentProfile.modelId,NHL_PERSISTENT_PROFILE_ID);
  assert.equal(out.nhlPersistentProfile.configured,true);
  assert.equal(out.nhlPersistentProfile.marketInformed,false);
  assert.equal(out.nhlPersistentProfile.canAuthorizeWager,false);
  assert.equal(out.nhlPersistentProfile.home.players.length,1);
});

test("haversine helper returns plausible Boston to Los Angeles travel",()=>{
  const miles=haversineMiles({lat:42.3662,lon:-71.0621},{lat:34.0430,lon:-118.2673});
  assert.ok(miles>2500&&miles<2700);
});


test("NHL special teams units use current pp/sh time-on-ice report fields",()=>{
  const roster=[
    {id:"1",position:"C"},{id:"2",position:"R"},{id:"3",position:"L"},{id:"4",position:"D"},{id:"5",position:"D"},
    {id:"6",position:"C"},{id:"7",position:"R"},{id:"8",position:"D"},{id:"9",position:"D"},{id:"10",position:"L"},
  ];
  const time=new Map(roster.map((p,i)=>[p.id,{
    ppTimeOnIcePerGame: i<5 ? 180-i*10 : 80-i,
    shTimeOnIcePerGame: i<4 ? 120-i*10 : 0,
  }]));
  const units=inferNhlSpecialTeamsUnits(roster,time);
  assert.equal(units.get("1").ppUnit,1);
  assert.equal(units.get("6").ppUnit,2);
  assert.equal(units.get("1").pkUnit,1);
  assert.equal(units.get("5").pkUnit,null);
});

test("NHL coach parser accepts ESPN roster coach arrays without explicit titles",()=>{
  const out=parseNhlCoachMetadata({coach:[{firstName:"Jim",lastName:"Example",experience:3}]});
  assert.equal(out.headCoach,"Jim Example");
  assert.equal(out.staff[0].title,"Head Coach");
});


test("NHL deployment tendencies measure role continuity and concentration",()=>{
  const players=[
    {playerId:"1",position:"C",evLine:1,ppUnit:1,rollingToiSeconds:1200},
    {playerId:"2",position:"R",evLine:1,ppUnit:1,rollingToiSeconds:1100},
    {playerId:"3",position:"L",evLine:1,ppUnit:1,rollingToiSeconds:1000},
    {playerId:"4",position:"C",evLine:2,ppUnit:2,rollingToiSeconds:900},
    {playerId:"5",position:"R",evLine:2,ppUnit:2,rollingToiSeconds:850},
    {playerId:"6",position:"L",evLine:2,ppUnit:2,rollingToiSeconds:800},
    {playerId:"7",position:"D",dPair:1,ppUnit:1,rollingToiSeconds:1300},
    {playerId:"8",position:"D",dPair:1,ppUnit:null,rollingToiSeconds:1250},
  ];
  const prior=new Map(players.map(p=>[p.playerId,{
    ev_line:p.evLine,d_pair:p.dPair,pp_unit:p.playerId==="4"?1:p.ppUnit
  }]));
  const out=buildNhlDeploymentTendencies(players,prior);
  assert.ok(out.topLineToiConcentration>0&&out.topLineToiConcentration<1);
  assert.ok(out.topSixToiConcentration>.9);
  assert.equal(out.matchedPlayers,8);
  assert.ok(out.evenStrengthContinuity>.9);
  assert.ok(out.ppContinuity<1);
  assert.equal(out.roleChanges,0);
});
