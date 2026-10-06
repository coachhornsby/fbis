import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEspnPlay, auditWnbaLineupEvidence } from "../functions/lib/wnbaLineupModel.js";
import {
  classifyWnbaShot,
  reconstructWnbaPossessionState,
  buildWnbaOpponentShotProfiles,
} from "../functions/lib/wnbaPossessionState.js";

test("WNBA PBP normalization preserves shot metadata",()=>{
  const p=normalizeEspnPlay({
    id:"1",sequenceNumber:10,period:{number:1},clock:{displayValue:"9:42"},
    type:{id:104,text:"Jump Shot"},text:"Player A makes 3-pt jump shot",
    team:{id:"H"},shootingPlay:true,scoringPlay:true,scoreValue:3,homeScore:3,awayScore:0,
    coordinate:{x:18.2,y:7.5},participants:[{athlete:{id:"p1",displayName:"Player A"}}],
  });
  assert.equal(p.shootingPlay,true);
  assert.equal(p.typeId,104);
  assert.equal(p.coordinate.x,18.2);
  assert.equal(p.coordinate.y,7.5);
  assert.equal(p.participants[0].id,"p1");
});

test("WNBA shot classifier distinguishes rim, paint, midrange and three",()=>{
  assert.equal(classifyWnbaShot({text:"A makes driving layup",shootingPlay:true,scoringPlay:true,scoreValue:2}).zone,"rim");
  assert.equal(classifyWnbaShot({text:"A misses floating jump shot",shootingPlay:true,scoreValue:2}).zone,"paint");
  assert.equal(classifyWnbaShot({text:"A misses pullup jumper",shootingPlay:true,scoreValue:2}).zone,"midrange");
  assert.equal(classifyWnbaShot({text:"A makes 3-pt jump shot",shootingPlay:true,scoringPlay:true,scoreValue:3}).zone,"three");
});

test("WNBA possession state reconstructs possessions and opponent shot profile without market data",()=>{
  const game={
    id:"g1",date:"2026-07-01",start:"2026-07-01T23:00:00Z",homeId:"H",awayId:"A",boxPossessions:4,
    plays:[
      {id:"1",sequenceNumber:1,period:1,clock:"10:00",type:"Jump Shot",text:"Home misses pullup jumper",teamId:"H",shootingPlay:true,scoringPlay:false,scoreValue:0,homeScore:0,awayScore:0,participants:[{id:"h1",name:"H1"}]},
      {id:"2",sequenceNumber:2,period:1,clock:"9:57",type:"Rebound",text:"Away defensive rebound",teamId:"A",homeScore:0,awayScore:0},
      {id:"3",sequenceNumber:3,period:1,clock:"9:52",type:"Layup",text:"Away makes driving layup",teamId:"A",shootingPlay:true,scoringPlay:true,scoreValue:2,homeScore:0,awayScore:2,participants:[{id:"a1",name:"A1"}]},
      {id:"4",sequenceNumber:4,period:1,clock:"9:40",type:"Turnover",text:"Home bad pass turnover",teamId:"H",homeScore:0,awayScore:2},
      {id:"5",sequenceNumber:5,period:1,clock:"9:35",type:"Jump Shot",text:"Away makes 3-pt jump shot",teamId:"A",shootingPlay:true,scoringPlay:true,scoreValue:3,homeScore:0,awayScore:5,participants:[{id:"a2",name:"A2"}]},
    ],
  };
  const r=reconstructWnbaPossessionState(game);
  assert.equal(r.ok,true);
  assert.equal(r.governance.canQualify,false);
  assert.equal(r.governance.marketInformed,false);
  assert.ok(r.possessions.length>=3);
  assert.equal(r.shots.length,3);
  assert.equal(r.teams.A.threePa,1);
  assert.equal(r.teams.H.midrangeRate,1);
  assert.ok(r.qa.zoneResolution>=0.99);
  const p=buildWnbaOpponentShotProfiles(r);
  assert.equal(p.H.oppShot.threeRate,r.teams.A.threeRate);
  assert.equal(p.A.oppShot.midrangeRate,r.teams.H.midrangeRate);
});

test("transition is a labeled proxy only after turnover or defensive rebound",()=>{
  const game={
    id:"g2",homeId:"H",awayId:"A",
    plays:[
      {id:"1",sequenceNumber:1,period:1,clock:"10:00",type:"Turnover",text:"Home turnover",teamId:"H",homeScore:0,awayScore:0},
      {id:"2",sequenceNumber:2,period:1,clock:"9:56",type:"Layup",text:"Away makes layup",teamId:"A",shootingPlay:true,scoringPlay:true,scoreValue:2,homeScore:0,awayScore:2},
    ],
  };
  const r=reconstructWnbaPossessionState(game);
  const away=r.possessions.find(x=>x.offenseTeamId==="A");
  assert.equal(Boolean(away?.transitionProxy),true);
  assert.equal(r.governance.researchOnly,true);
});


test("WNBA lineup audit separates substitution resolution from stint coverage",()=>{
  const q=auditWnbaLineupEvidence({
    homeTeamId:"H",awayTeamId:"A",
    homePlayers:[
      {id:"h1",name:"H1",starter:1},{id:"h2",name:"H2",starter:1},{id:"h3",name:"H3",starter:1},{id:"h4",name:"H4",starter:1},{id:"h5",name:"H5",starter:1},{id:"h6",name:"H6",starter:0}
    ],
    awayPlayers:[
      {id:"a1",name:"A1",starter:1},{id:"a2",name:"A2",starter:1},{id:"a3",name:"A3",starter:1},{id:"a4",name:"A4",starter:1},{id:"a5",name:"A5",starter:1}
    ],
    plays:[
      {id:"s1",period:1,clock:"8:00",teamId:"H",type:"Substitution",text:"H6 enters the game for H1",participants:[{id:"h6",name:"H6"},{id:"h1",name:"H1"}]},
      {id:"s2",period:1,clock:"7:00",teamId:"H",type:"Substitution",text:"Unknown enters the game for H9",participants:[{id:"hx",name:"Unknown"},{id:"h9",name:"H9"}]},
    ],
  });
  assert.equal(q.substitutionEvents,2);
  assert.equal(q.resolved,1);
  assert.equal(q.unresolved,1);
  assert.equal(q.resolutionRate,0.5);
});
