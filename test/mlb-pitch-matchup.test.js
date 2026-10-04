import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLineupMatchup,
  buildStatcastProfiles,
  pitchFamily,
  plateZone,
  scorePitcherVsBatter,
} from "../functions/lib/mlbPitchMatchup.js";

function pitch({ pitcher=1,batter=10,pitch_type="FF",description="called_strike",type="S",events="",release_speed=96,release_spin_rate=2400,pfx_x=-0.4,pfx_z=1.3,plate_x=0,plate_z=2.5,sz_top=3.5,sz_bot=1.5,launch_speed="",launch_speed_angle="",estimated_woba_using_speedangle="",game_date="2026-09-20" }={}) {
  return {pitcher,batter,pitch_type,description,type,events,release_speed,release_spin_rate,pfx_x,pfx_z,plate_x,plate_z,sz_top,sz_bot,launch_speed,launch_speed_angle,estimated_woba_using_speedangle,game_date};
}

test("pitch family and plate grid normalize Statcast inputs",()=>{
  assert.equal(pitchFamily("FF"),"four_seam");
  assert.equal(pitchFamily("ST"),"slider_sweeper");
  assert.equal(plateZone(pitch({plate_x:0,plate_z:2.5})),"middle_middle");
  assert.equal(plateZone(pitch({plate_x:0,plate_z:4.2})),"chase_above");
});

test("Statcast profiles retain pitch dynamics and contact outcomes",()=>{
  const rows=[
    pitch({description:"swinging_strike",type:"S"}),
    pitch({description:"hit_into_play",type:"X",events:"single",launch_speed:101,launch_speed_angle:6,estimated_woba_using_speedangle:0.55}),
    pitch({description:"swinging_strike",type:"S",events:"strikeout"}),
  ];
  const profiles=buildStatcastProfiles(rows,{role:"pitcher",asOf:"2026-09-21T00:00:00Z"});
  const p=profiles["1"];
  assert.ok(p);
  assert.ok(p.global.velocity>95);
  assert.ok(p.global.spin>2300);
  assert.ok(p.global.whiffPerSwing>0);
  assert.ok(p.global.hardHitRate>0);
  assert.ok(p.kRate>0);
});

test("pitcher vs hitter score rewards difficult arsenal against high-whiff profile",()=>{
  const pitcherRows=[];
  const batterRows=[];
  for(let i=0;i<40;i++){
    pitcherRows.push(pitch({pitcher:1,batter:90+i,pitch_type:i%2?"FF":"SL",release_speed:i%2?98:88,release_spin_rate:i%2?2500:2700,pfx_x:i%2?-0.5:0.9,pfx_z:i%2?1.4:0.2,description:i%3===0?"swinging_strike":"called_strike",events:i%10===0?"strikeout":""}));
    batterRows.push(pitch({pitcher:80+i,batter:10,pitch_type:i%2?"FF":"SL",release_speed:i%2?94:85,release_spin_rate:i%2?2200:2400,pfx_x:i%2?-0.3:0.6,pfx_z:i%2?1.1:0.1,description:i%2===0?"swinging_strike":"foul",events:i%8===0?"strikeout":""}));
  }
  const pp=buildStatcastProfiles(pitcherRows,{role:"pitcher",asOf:"2026-09-21T00:00:00Z"})["1"];
  const bp=buildStatcastProfiles(batterRows,{role:"batter",asOf:"2026-09-21T00:00:00Z"})["10"];
  const score=scorePitcherVsBatter(pp,bp);
  assert.ok(score);
  assert.ok(score.kRate>0.1);
  assert.ok(score.dynamicDifficulty>0);
  assert.ok(score.runFactor>=0.88&&score.runFactor<=1.12);
});

test("lineup matchup produces K projection from batter-by-batter zone profiles",()=>{
  const pitcherRows=[];
  for(let i=0;i<120;i++)pitcherRows.push(pitch({pitcher:1,batter:100+i,pitch_type:i%3===0?"SL":"FF",description:i%4===0?"swinging_strike":"called_strike",events:i%12===0?"strikeout":""}));
  const pp=buildStatcastProfiles(pitcherRows,{role:"pitcher",asOf:"2026-09-21T00:00:00Z"})["1"];
  const batters=[];
  for(let b=0;b<9;b++){
    const rows=[];
    for(let i=0;i<60;i++)rows.push(pitch({pitcher:200+i,batter:10+b,pitch_type:i%3===0?"SL":"FF",description:i%5===0?"swinging_strike":"foul",events:i%10===0?"strikeout":""}));
    batters.push(buildStatcastProfiles(rows,{role:"batter",asOf:"2026-09-21T00:00:00Z"})[String(10+b)]);
  }
  const m=buildLineupMatchup({pitcherProfile:pp,batterProfiles:batters,expectedInnings:5.8,battersFacedPerInning:4.25});
  assert.ok(m);
  assert.equal(m.batters,9);
  assert.ok(m.projectedKs>0);
  assert.ok(m.lineupKRate>0&&m.lineupKRate<0.5);
  assert.equal(m.marketInformed,false);
});
