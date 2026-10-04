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

import {
  aggregateNcaaCbbGame,
  aggregateNcaaValidatedLineups,
  cbbNcaaPossessionFeatures,
} from "../functions/lib/cbbNcaaPossessionModel.js";

test("NCAA enriched PBP aggregates possessions, lineups, shot profile and QA",()=>{
  const common={
    contest_id:"c1",espn_game_id:"e1",game_date:"2025-01-10",
    home:"Home",away:"Away",
    home_ncaa_team_id:"NH",away_ncaa_team_id:"NA",
    home_espn_team_id:"H",away_espn_team_id:"A",
    sub_deviate:"0",
    home_1_player_id:"H1",home_2_player_id:"H2",home_3_player_id:"H3",home_4_player_id:"H4",
    away_1_player_id:"A1",away_2_player_id:"A2",away_3_player_id:"A3",away_4_player_id:"A4",away_5_player_id:"A5",
  };
  const rows=[
    {...common,period:"1",poss_num:"1",poss_team:"Home",poss_team_espn_team_id:"H",
      home_5_player_id:"H5",game_seconds:"10",home_score:"2",away_score:"0",
      event_team:"Home",event_team_espn_team_id:"H",event_type:"SHOT",event_description:"H1 made layup",
      event_result:"made",shot_value:"2",is_paint:"true",is_transition:"true"},
    {...common,period:"1",poss_num:"2",poss_team:"Away",poss_team_espn_team_id:"A",
      home_5_player_id:"H6",game_seconds:"24",home_score:"2",away_score:"0",
      event_team:"Away",event_team_espn_team_id:"A",event_type:"TURNOVER",event_description:"A1 bad pass turnover"},
    {...common,period:"1",poss_num:"3",poss_team:"Home",poss_team_espn_team_id:"H",
      home_5_player_id:"H6",game_seconds:"35",home_score:"5",away_score:"0",
      event_team:"Home",event_team_espn_team_id:"H",event_type:"SHOT",event_description:"H2 made three point jumper",
      event_result:"made",shot_value:"3",is_transition:"false"},
  ];
  const out=aggregateNcaaCbbGame(rows);
  assert.equal(out.ok,true);
  assert.equal(out.lineupReliable,true);
  assert.equal(out.qa.lineupCoverage,1);
  assert.equal(out.qa.subDeviate,0);
  assert.equal(out.teams.H.possessions,2);
  assert.equal(out.teams.A.possessions,1);
  assert.equal(out.teams.H.pointsFor,5);
  assert.equal(out.teams.H.fga,2);
  assert.equal(out.teams.H.fgm,2);
  assert.equal(out.teams.H.threePa,1);
  assert.equal(out.teams.H.rimA,1);
  assert.equal(out.teams.H.transitionPoss,1);
  assert.ok(out.teams.H.topFiveLineups.some(x=>x.players.includes("H5")));
  assert.ok(out.teams.H.topFiveLineups.some(x=>x.players.includes("H6")));
  const f=cbbNcaaPossessionFeatures(out);
  assert.equal(f.lineupCoverage,1);
  assert.ok(Object.hasOwn(f,"rimRateDiff"));
  assert.ok(Object.hasOwn(f,"transitionRateDiff"));
});

test("ESPN reconstruction cannot certify lineups without substitution evidence",()=>{
  const rows=[
    {...base,sequence_number:1,period_number:1,clock_display_value:"20:00",team_id:"H",type_text:"Jump Shot",text:"H1 missed jumper",shooting_play:true,home_score:0,away_score:0},
    {...base,sequence_number:2,period_number:1,clock_display_value:"19:58",team_id:"A",type_text:"Defensive Rebound",text:"A1 defensive rebound",home_score:0,away_score:0},
  ];
  const out=reconstructCbbGame(rows,{H:["H1","H2","H3","H4","H5"],A:["A1","A2","A3","A4","A5"]});
  assert.equal(out.qa.subEvents,0);
  assert.equal(out.lineupReliable,false);
});


test("validated NCAA lineup stints aggregate 2-5 man efficiency and shot profiles",()=>{
  const baseLineup={
    contest_id:"c1",location_type:"Home",team:"Home",opponent:"Away",
    player_1:"H1",player_2:"H2",player_3:"H3",player_4:"H4",player_5:"H5",
    poss:"10",opp_poss:"10",pts:"12",opp_pts:"9",fga:"9",fgm:"5",tpa:"3",tpm:"2",
    rima:"4",rimm:"3",mida:"2",midm:"0",fta:"2",orb:"2",drb:"6",to:"1",ast:"4",
  };
  const rows=[
    baseLineup,
    {...baseLineup,location_type:"Away",team:"Away",opponent:"Home",
      player_1:"A1",player_2:"A2",player_3:"A3",player_4:"A4",player_5:"A5",
      poss:"10",opp_poss:"10",pts:"9",opp_pts:"12",fga:"8",fgm:"4",tpa:"2",tpm:"1",
      rima:"3",rimm:"2",mida:"3",midm:"1"},
  ];
  const out=aggregateNcaaValidatedLineups(rows);
  assert.equal(out.home.rows,1);
  assert.equal(out.away.rows,1);
  assert.equal(out.home.topFiveLineups.length,1);
  assert.equal(out.home.topFour.length,5);
  assert.equal(out.home.topThree.length,10);
  assert.equal(out.home.topTwo.length,10);
  assert.equal(out.home.topFiveLineups[0].offensiveRating,120);
  assert.equal(out.home.topFiveLineups[0].defensiveRating,90);
  assert.equal(out.home.topFiveLineups[0].netRating,30);
  assert.equal(out.home.topFiveLineups[0].rimRate,4/9);
});
