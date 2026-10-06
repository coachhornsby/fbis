import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDynamicSkillProfile,boxImpactPrior,fitRegularizedRapm,combinePlayerImpact
} from "../functions/lib/nbaPlayerImpact.js";
import {
  parseSubstitution,reconstructLineupStints,attachStintOutcomes,aggregateLineupEffects
} from "../functions/lib/nbaLineupModel.js";
import { buildRoleRedistribution } from "../functions/lib/nbaRoleRedistribution.js";
import { projectNbaPlayer } from "../functions/lib/nbaPlayerPropModel.js";

const hist=Array.from({length:20},(_,i)=>({
  date:`2026-01-${String((i%28)+1).padStart(2,"0")}`,minutes:34,points:24+i%4,rebounds:7,offensiveRebounds:1.2,
  assists:6,turnovers:2.3,steals:1.4,blocks:.5,threes:2.6,fga:18,fta:5,starter:1
}));

test("dynamic skill and SPM-style prior are finite and market-free",()=>{
  const s=buildDynamicSkillProfile(hist,{asOf:"2026-03-01"});
  const p=boxImpactPrior(s);
  assert.ok(s.pointsPer36>20);
  assert.ok(Number.isFinite(p.net));
  assert.equal(p.proprietaryMetricUsed,false);
});

test("regularized RAPM shrinks toward prior",()=>{
  const prior={A:{net:3,offense:2,defense:1},B:{net:1,offense:.7,defense:.3},C:{net:0,offense:0,defense:0},D:{net:0,offense:0,defense:0},E:{net:0,offense:0,defense:0},
    F:{net:0,offense:0,defense:0},G:{net:0,offense:0,defense:0},H:{net:0,offense:0,defense:0},I:{net:0,offense:0,defense:0},J:{net:0,offense:0,defense:0}};
  const stints=Array.from({length:30},()=>({homePlayers:["A","B","C","D","E"],awayPlayers:["F","G","H","I","J"],possessions:10,pointDifferential:1}));
  const r=fitRegularizedRapm(stints,{priorByPlayer:prior,lambda:900,iterations:30});
  assert.equal(r.stints,30);
  assert.ok(r.players.A.net>0);
  assert.ok(Math.abs(r.players.A.net)<15);
});

test("ESPN substitution parsing and lineup reconstruction work",()=>{
  const sub=parseSubstitution({id:"2",period:{number:1},clock:{displayValue:"6:00"},type:{text:"Substitution"},team:{id:"H"},
    text:"Bench Guy enters the game for Starter Five",participants:[{athlete:{id:"H6",displayName:"Bench Guy"}},{athlete:{id:"H5",displayName:"Starter Five"}}]});
  assert.equal(sub.playerIn.id,"H6");
  const home=Array.from({length:6},(_,i)=>({id:`H${i+1}`,name:i===5?"Bench Guy":`Starter ${i+1}`,starter:i<5}));
  home[4].name="Starter Five";
  const away=Array.from({length:5},(_,i)=>({id:`A${i+1}`,name:`Away ${i+1}`,starter:1}));
  const plays=[
    {id:"1",period:{number:1},clock:{displayValue:"12:00"},type:{text:"Jump Ball"},team:{id:"H"},text:"start"},
    {id:"2",period:{number:1},clock:{displayValue:"6:00"},type:{text:"Substitution"},team:{id:"H"},text:"Bench Guy enters the game for Starter Five",
      participants:[{athlete:{id:"H6",displayName:"Bench Guy"}},{athlete:{id:"H5",displayName:"Starter Five"}}]},
    {id:"3",period:{number:1},clock:{displayValue:"5:30"},type:{text:"Made Shot"},team:{id:"H"},text:"made shot",scoringPlay:true,scoreValue:2}
  ];
  const stints=attachStintOutcomes(reconstructLineupStints({plays,homeTeamId:"H",awayTeamId:"A",homePlayers:home,awayPlayers:away}),plays);
  assert.ok(stints.length>=2);
  assert.ok(stints.some(s=>s.homePlayers.includes("H6")));
  const effects=aggregateLineupEffects(stints,0);
  assert.ok(effects.some(x=>x.kind==="pair"));
});

test("role redistribution moves minutes and usage toward active same-role player",()=>{
  const roster={
    p1:{position:"G",skill:{minutes:32,usage:24,reboundsPer36:4,assistsPer36:7,threesPer36:3}},
    p2:{position:"G",skill:{minutes:30,usage:27,reboundsPer36:4,assistsPer36:6,threesPer36:3}},
    p3:{position:"F",skill:{minutes:28,usage:20,reboundsPer36:7,assistsPer36:3,threesPer36:2}}
  };
  const r=buildRoleRedistribution({targetPlayerId:"p1",rosterImpacts:roster,unavailablePlayers:[{playerId:"p2",status:"OUT"}]});
  assert.ok(r.minutesDelta>0);
  assert.ok(r.usageMultiplier>1);
});

test("impact and role context change projection without market input",()=>{
  const base=projectNbaPlayer({id:"p",name:"P"},{history:hist,teamProjection:116,gamePossessions:100});
  const enhanced=projectNbaPlayer({id:"p",name:"P"},{history:hist,teamProjection:116,gamePossessions:100,
    impactContext:{modelId:"NBA-FBIS-PLAYER-IMPACT-v1",version:"research-v1",offense:4},
    roleContext:{minutesDelta:3,pointsMultiplier:1.08,reboundsMultiplier:1.03,assistsMultiplier:1.05,threesMultiplier:1.06},
    lineupContext:{multiplier:1.01}});
  assert.ok(enhanced.minutes>base.minutes);
  assert.ok(enhanced.markets.points.projection>base.markets.points.projection);
  assert.equal(enhanced.marketInformed,false);
  assert.equal(enhanced.provenance.impactModel,"NBA-FBIS-PLAYER-IMPACT-v1");
});

test("combined impact exposes diagnostics without requiring proprietary metrics",()=>{
  const x=combinePlayerImpact({playerId:"p",history:hist,asOf:"2026-03-01"});
  assert.equal(x.ok,true);
  assert.equal(x.governance.proprietaryMetricRequired,false);
  assert.ok(Number.isFinite(x.diagnostics.bpmStyle));
});
