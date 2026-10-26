import test from "node:test";
import assert from "node:assert/strict";
import {compare} from "../scripts/cfb-phase4-ncaa-verify.mjs";
const g={game_id:"401",week:5,home_team_source:"Georgia",away_team_source:"Vanderbilt"};
const final={secondary_home_score:28,secondary_away_score:14};
const contest={contestId:"ncaa-1",gameState:"F",teams:[{isHome:true,nameShort:"Georgia",score:28},{isHome:false,nameShort:"Vanderbilt",score:14}]};
test("independent NCAA final confirms only exact home and away names and scores",()=>{const r=compare(g,final,[contest]);assert.equal(r.independent_ncaa_verified,true);assert.equal(r.ncaa_contest_id,"ncaa-1");});
test("conflicting scores explicitly fail",()=>{const r=compare(g,final,[{...contest,teams:[{...contest.teams[0],score:27},contest.teams[1]]}]);assert.equal(r.status,"FINAL_SCORE_CONFLICT");assert.equal(r.independent_ncaa_verified,false);});
test("ambiguous scoreboards and claimed contest IDs never certify",()=>{assert.equal(compare(g,final,[contest,contest]).status,"AMBIGUOUS_NCAA_IDENTITY");assert.equal(compare(g,final,[contest],new Set(["ncaa-1"])).independent_ncaa_verified,false);});
test("in-progress games cannot certify",()=>assert.equal(compare(g,final,[{...contest,gameState:"I"}]).independent_ncaa_verified,false));

test("NCAA abbreviated State and accented San José names reconcile conservatively",()=>{
 const miss={game_id:"2",week:5,home_team_source:"Mississippi State",away_team_source:"Alabama"};
 const c={contestId:"2",gameState:"F",teams:[{isHome:true,nameShort:"Mississippi St.",score:23},{isHome:false,nameShort:"Alabama",score:56}]};
 assert.equal(compare(miss,{secondary_home_score:23,secondary_away_score:56},[c]).independent_ncaa_verified,true);
 const jose={game_id:"3",week:5,home_team_source:"San José State",away_team_source:"Wyoming"};
 const d={contestId:"3",gameState:"F",teams:[{isHome:true,nameShort:"San Jose St.",score:13},{isHome:false,nameShort:"Wyoming",score:16}]};
 assert.equal(compare(jose,{secondary_home_score:13,secondary_away_score:16},[d]).independent_ncaa_verified,true);
});
