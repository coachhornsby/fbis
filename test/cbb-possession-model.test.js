import test from "node:test";
import assert from "node:assert/strict";
import {
  reconstructCbbGame,
  cbbPossessionGameFeatures,
  parseClockSeconds,
} from "../functions/lib/cbbPossessionModel.js";

const base = {
  game_id:"g1",home_team_id:"H",away_team_id:"A",
  home_team_name:"Home",away_team_name:"Away",
};

test("clock parser accepts display and numeric fields",()=>{
  assert.equal(parseClockSeconds({clock_display_value:"12:34"}),754);
  assert.equal(parseClockSeconds({clock_minutes:3,clock_seconds:7}),187);
  assert.equal(parseClockSeconds({start_period_seconds_remaining:998}),998);
});

test("reconstructs possessions, shot-clock phases and lineup substitutions",()=>{
  const rows=[
    {...base,sequence_number:1,period_number:1,clock_display_value:"20:00",team_id:"H",type_text:"Jump Ball",home_score:0,away_score:0},
    {...base,sequence_number:2,period_number:1,clock_display_value:"19:52",team_id:"H",type_text:"Jump Shot",text:"H1 made jumper",shooting_play:true,scoring_play:true,score_value:2,athlete_id_1:"H1",home_score:2,away_score:0},
    {...base,sequence_number:3,period_number:1,clock_display_value:"19:30",team_id:"A",type_text:"Turnover",text:"A1 turnover",athlete_id_1:"A1",home_score:2,away_score:0},
    {...base,sequence_number:4,period_number:1,clock_display_value:"19:20",team_id:"H",type_text:"Substitution",text:"H6 enters the game for H5",athlete_id_1:"H6",athlete_id_2:"H5",home_score:2,away_score:0},
    {...base,sequence_number:5,period_number:1,clock_display_value:"19:08",team_id:"H",type_text:"3-pt Jump Shot",text:"H2 missed 3-pt jumper",shooting_play:true,athlete_id_1:"H2",home_score:2,away_score:0},
    {...base,sequence_number:6,period_number:1,clock_display_value:"19:05",team_id:"H",type_text:"Offensive Rebound",text:"H6 offensive rebound",athlete_id_1:"H6",home_score:2,away_score:0},
    {...base,sequence_number:7,period_number:1,clock_display_value:"18:48",team_id:"H",type_text:"Jump Shot",text:"H6 missed jumper",shooting_play:true,athlete_id_1:"H6",home_score:2,away_score:0},
    {...base,sequence_number:8,period_number:1,clock_display_value:"18:46",team_id:"A",type_text:"Defensive Rebound",text:"A2 defensive rebound",athlete_id_1:"A2",home_score:2,away_score:0},
    {...base,sequence_number:9,period_number:1,clock_display_value:"18:20",team_id:"A",type_text:"Jump Shot",text:"A3 made jumper",shooting_play:true,scoring_play:true,score_value:2,athlete_id_1:"A3",home_score:2,away_score:2},
  ];
  const starters={H:["H1","H2","H3","H4","H5"],A:["A1","A2","A3","A4","A5"]};
  const out=reconstructCbbGame(rows,starters);
  assert.equal(out.ok,true);
  assert.ok(out.qa.totalPossessions>=3);
  assert.equal(out.qa.subResolved,1);
  assert.equal(out.qa.lineupSizeFaults,0);
  assert.equal(out.teams.H.fga,3);
  assert.equal(out.teams.H.fgm,1);
  assert.equal(out.teams.H.threePa,1);
  assert.equal(out.teams.H.orb,1);
  assert.ok(out.teams.H.combinations.some(x=>x.size===5 && x.players.includes("H6")));
  assert.ok(out.teams.H.lateEfgPct !== undefined);
  const f=cbbPossessionGameFeatures(out);
  assert.ok(Object.hasOwn(f,"efgPctDiff"));
  assert.equal(f.lineupCoverage,out.qa.lineupCoverage);
});

test("membership evidence reverses ambiguous participant ordering safely",()=>{
  const rows=[
    {...base,sequence_number:1,period_number:1,clock_display_value:"20:00",team_id:"H",type_text:"Jump Shot",text:"H1 missed jumper",shooting_play:true,home_score:0,away_score:0},
    {...base,sequence_number:2,period_number:1,clock_display_value:"19:58",team_id:"A",type_text:"Defensive Rebound",text:"A1 defensive rebound",home_score:0,away_score:0},
    {...base,sequence_number:3,period_number:1,clock_display_value:"19:50",team_id:"H",type_text:"Substitution",text:"substitution",athlete_id_1:"H5",athlete_id_2:"H6",home_score:0,away_score:0},
    {...base,sequence_number:4,period_number:1,clock_display_value:"19:40",team_id:"A",type_text:"Turnover",text:"turnover",home_score:0,away_score:0},
    {...base,sequence_number:5,period_number:1,clock_display_value:"19:30",team_id:"H",type_text:"Jump Shot",text:"H6 made jumper",shooting_play:true,scoring_play:true,score_value:2,home_score:2,away_score:0},
  ];
  const out=reconstructCbbGame(rows,{H:["H1","H2","H3","H4","H5"],A:["A1","A2","A3","A4","A5"]});
  assert.equal(out.qa.subResolved,1);
  assert.ok(out.teams.H.combinations.some(x=>x.size===5 && x.players.includes("H6")));
});
