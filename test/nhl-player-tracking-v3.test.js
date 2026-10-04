import test from "node:test";
import assert from "node:assert/strict";
import {normalizeNhlPlayerEdge,aggregateNhlTrackingMatchup} from "../functions/lib/nhlPlayerTrackingV3.js";

test("NHL player EDGE normalizer extracts supported telemetry without market inputs",()=>{
  const x=normalizeNhlPlayerEdge({
    skating:{maxSkatingSpeed:23.6,bursts22Plus:9,totalDistance:3.8},
    shooting:{maxShotSpeed:94.2,avgShotSpeed:82.1,highDangerShots:14,slotShots:21},
    zone:{offensiveZonePct:0.412}
  });
  assert.equal(x.available,true);
  assert.equal(x.maxSkatingSpeed,23.6);
  assert.equal(x.maxShotSpeed,94.2);
  assert.equal(x.highDangerShots,14);
  assert.ok(x.coverage>0);
});

test("NHL tracking matchup aggregation stays advisory",()=>{
  const base={skatersByTeam:{
    BOS:[{id:"1",shotsPerGame:4,pointsPerGame:1},{id:"2",shotsPerGame:2,pointsPerGame:.5}],
    NYR:[{id:"3",shotsPerGame:3,pointsPerGame:.8}]
  }};
  const edge={byPlayer:{
    "1":{available:true,maxSkatingSpeed:23,maxShotSpeed:95,highDangerShots:12,slotShots:18,offensiveZonePct:.42,bursts22Plus:8},
    "2":{available:true,maxSkatingSpeed:21,maxShotSpeed:89,highDangerShots:6,slotShots:10,offensiveZonePct:.38,bursts22Plus:2},
    "3":{available:true,maxSkatingSpeed:22,maxShotSpeed:91,highDangerShots:8,slotShots:12,offensiveZonePct:.39,bursts22Plus:4}
  }};
  const out=aggregateNhlTrackingMatchup("BOS","NYR",base,edge);
  assert.equal(out.researchOnly,true);
  assert.ok(out.team.coverage>0);
  assert.ok(Number.isFinite(out.differential.maxShotSpeed));
});
