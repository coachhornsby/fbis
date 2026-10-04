import test from "node:test";
import assert from "node:assert/strict";
import { buildWnbaDynamicSkill, wnbaBoxImpactPrior, fitWnbaRapm, combineWnbaPlayerImpact } from "../functions/lib/wnbaPlayerImpact.js";
import { reconstructLineupStints, attachStintOutcomes } from "../functions/lib/wnbaLineupModel.js";
import { buildWnbaRoleRedistribution } from "../functions/lib/wnbaRoleRedistribution.js";
import { applyWnbaPropImpactShadow, applyWnbaGameImpactShadow } from "../functions/lib/wnbaPlayerImpactShadow.js";

const hist=Array.from({length:16},(_,i)=>({
  date:`2026-06-${String((i%28)+1).padStart(2,"0")}`,minutes:31,points:18+i%4,rebounds:6,assists:4.5,turnovers:2,
  steals:1.4,blocks:.6,threes:1.8,fga:14,fta:4
}));

test("WNBA dynamic skill and impact prior are finite and market-free",()=>{
  const s=buildWnbaDynamicSkill(hist,{asOf:"2026-08-01"});
  const p=wnbaBoxImpactPrior(s);
  assert.ok(s.pointsPer40>20);
  assert.ok(Number.isFinite(p.net));
  assert.equal(p.proprietaryMetricUsed,false);
});

test("WNBA RAPM is regularized toward prior",()=>{
  const ids=["A","B","C","D","E","F","G","H","I","J"];
  const prior=Object.fromEntries(ids.map((id,i)=>[id,{net:i===0?3:0,offense:i===0?2:0,defense:i===0?1:0}]));
  const stints=Array.from({length:25},()=>({homePlayers:ids.slice(0,5),awayPlayers:ids.slice(5),possessions:8,pointDifferential:1}));
  const r=fitWnbaRapm(stints,{priorByPlayer:prior,lambda:720,iterations:25});
  assert.equal(r.stints,25);
  assert.ok(r.players.A.net>0);
  assert.ok(Math.abs(r.players.A.net)<15);
});

test("WNBA lineup reconstruction uses 10-minute regulation quarters",()=>{
  const home=Array.from({length:6},(_,i)=>({id:`H${i+1}`,name:i===5?"Bench":"Starter "+(i+1),starter:i<5}));
  const away=Array.from({length:5},(_,i)=>({id:`A${i+1}`,name:"Away "+(i+1),starter:1}));
  const plays=[
    {id:"1",period:{number:1},clock:{displayValue:"10:00"},type:{text:"Jump Ball"},team:{id:"H"},text:"start"},
    {id:"2",period:{number:1},clock:{displayValue:"5:00"},type:{text:"Substitution"},team:{id:"H"},text:"Bench enters the game for Starter 5",
      participants:[{athlete:{id:"H6",displayName:"Bench"}},{athlete:{id:"H5",displayName:"Starter 5"}}]}
  ];
  const stints=attachStintOutcomes(reconstructLineupStints({plays,homeTeamId:"H",awayTeamId:"A",homePlayers:home,awayPlayers:away}),plays);
  assert.ok(stints.length>=2);
  assert.equal(stints[0].durationSeconds,300);
  assert.ok(stints.some(s=>s.homePlayers.includes("H6")));
});

test("WNBA role redistribution shifts minutes and usage when a same-role player is out",()=>{
  const roster={
    p1:{position:"G",skill:{minutes:31,usage:22,reboundsPer40:5,assistsPer40:6,threesPer40:2}},
    p2:{position:"G",skill:{minutes:30,usage:25,reboundsPer40:4,assistsPer40:5,threesPer40:2.5}},
    p3:{position:"F",skill:{minutes:27,usage:18,reboundsPer40:8,assistsPer40:2,threesPer40:1}}
  };
  const r=buildWnbaRoleRedistribution({targetPlayerId:"p1",rosterImpacts:roster,unavailablePlayers:[{playerId:"p2",status:"OUT"}]});
  assert.ok(r.minutesDelta>0);
  assert.ok(r.usageMultiplier>1);
});

test("WNBA prop and game impact layers stay shadow-only",()=>{
  const row={fbisProjection:18,fbisSigma:4,market:"points",role:{minutes:30}};
  const p=applyWnbaPropImpactShadow(row,{impact:{offense:4,net:3},role:{minutesDelta:2,pointsMultiplier:1.05},lineup:{multiplier:1.01},availabilityVerified:true});
  assert.equal(p.impactShadow.canQualify,false);
  assert.equal(p.impactShadow.canAuthorize,false);
  assert.ok(p.impactShadow.projection>18);
  const g=applyWnbaGameImpactShadow({wnbaV2:{ok:true,home:84,away:80,margin:4,total:164,sigmaMargin:10.2,sigmaTotal:12.1}},{homeAdjustment:-2,awayAdjustment:0,availabilityVerified:true});
  assert.equal(g.margin,2);
  assert.equal(g.canQualify,false);
});

test("combined WNBA impact does not require proprietary external metrics",()=>{
  const x=combineWnbaPlayerImpact({playerId:"p",history:hist,asOf:"2026-08-01"});
  assert.equal(x.ok,true);
  assert.equal(x.governance.proprietaryMetricRequired,false);
});
