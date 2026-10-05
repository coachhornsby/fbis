import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveNhlScheduleStress,buildShiftDeployment,inferNhlRoles,resolveNhlPlayerState,replacementCandidates
} from "../functions/lib/nhlPersistentProfile.js";

test("persistent NHL scratch carries until stronger active evidence arrives",()=>{
  const s=resolveNhlPlayerState({
    player:{id:"1",name:"A"},
    priorState:{status:"CONFIRMED_SCRATCH",state_source_timestamp:"2026-10-04T20:00:00Z"},
    observedAt:"2026-10-05T12:00:00Z"
  });
  assert.equal(s.status,"CONFIRMED_SCRATCH");
  assert.equal(s.carriedForward,true);
  const active=resolveNhlPlayerState({
    player:{id:"1",name:"A"},priorState:{status:"CONFIRMED_SCRATCH",state_source_timestamp:"2026-10-04T20:00:00Z"},
    lastGameActive:true,observedAt:"2026-10-05T23:00:00Z"
  });
  assert.equal(active.status,"ACTIVE");
  assert.equal(active.carriedForward,false);
});

test("shift deployment produces linemate overlap without using market data",()=>{
  const roster=[{id:"1",name:"A",position:"C"},{id:"2",name:"B",position:"LW"},{id:"3",name:"C",position:"RW"}];
  const shifts=[
    {playerId:"1",teamAbbrev:"BOS",period:1,startTime:"00:00",endTime:"00:45"},
    {playerId:"2",teamAbbrev:"BOS",period:1,startTime:"00:05",endTime:"00:40"},
    {playerId:"3",teamAbbrev:"BOS",period:1,startTime:"00:10",endTime:"00:35"}
  ];
  const d=buildShiftDeployment(shifts,roster);
  assert.equal(d.players["1"].toiSeconds,45);
  assert.equal(d.players["1"].linemates[0].playerId,"2");
  assert.ok(d.edges.some(x=>x.playerId==="1"&&x.linemateId==="2"&&x.overlapSeconds===35));
});

test("role inference creates EV lines, D pairs and PP units",()=>{
  const roster=[
    {id:"1",name:"F1",position:"C"},{id:"2",name:"F2",position:"LW"},{id:"3",name:"F3",position:"RW"},
    {id:"4",name:"F4",position:"C"},{id:"5",name:"D1",position:"D"},{id:"6",name:"D2",position:"D"}
  ];
  const stats={
    "1":{toiPerGame:1200,ppToiPerGame:210},"2":{toiPerGame:1180,ppToiPerGame:190},"3":{toiPerGame:1150,ppToiPerGame:180},
    "4":{toiPerGame:900,ppToiPerGame:80},"5":{toiPerGame:1400,ppToiPerGame:200},"6":{toiPerGame:1300,ppToiPerGame:60}
  };
  const r=inferNhlRoles(roster,stats,{players:{}});
  assert.equal(r.skaters.find(x=>x.id==="1").evRole,"L1");
  assert.equal(r.skaters.find(x=>x.id==="5").evRole,"D1");
  assert.equal(r.skaters.find(x=>x.id==="1").ppUnit,"PP1");
});

test("schedule state flags NHL compression and travel",()=>{
  const rows=deriveNhlScheduleStress([
    {gameId:"1",startTime:"2026-10-10T01:00:00Z",homeAway:"home",venueTeamKey:"BOS",opponentKey:"NYR"},
    {gameId:"2",startTime:"2026-10-11T01:00:00Z",homeAway:"away",venueTeamKey:"COL",opponentKey:"COL"},
    {gameId:"3",startTime:"2026-10-13T01:00:00Z",homeAway:"away",venueTeamKey:"VGK",opponentKey:"VGK"}
  ],"BOS");
  assert.equal(rows[1].backToBack,true);
  assert.ok(rows[1].travelMiles>1000);
  assert.ok(rows[1].stressReasons.includes("ALTITUDE_ROAD_GAME"));
});

test("replacement candidates prioritize same deployment role and PP unit",()=>{
  const players=[
    {id:"a",position:"C",evRole:"L1",ppUnit:"PP1",toiSeconds:1200,linemates:[{playerId:"b",overlapSeconds:700}]},
    {id:"b",position:"C",evRole:"L2",ppUnit:"PP1",toiSeconds:1100,linemates:[]},
    {id:"c",position:"D",evRole:"D1",ppUnit:"PP1",toiSeconds:1300,linemates:[]}
  ];
  const r=replacementCandidates("a",players);
  assert.equal(r[0].playerId,"b");
});
