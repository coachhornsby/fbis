import test from "node:test";
import assert from "node:assert/strict";
import {buildNbaCurrentGrade} from "../scripts/nba-current-season-grade.mjs";
const g={id:"401900001",start:"2026-10-24T23:00:00Z",homeScore:112,awayScore:100,
 players:[{id:"42",points:21,rebounds:9,assists:7,threes:3},{id:"99",points:0,rebounds:4,assists:0,threes:0}]};
const projection={id:"g1",game_id:g.id,feature_cutoff_timestamp:"2026-10-24T20:00:00Z"};
const prop=(market_type,id="p1")=>({id,game_id:g.id,player_id:"42",market_type,feature_cutoff_timestamp:projection.feature_cutoff_timestamp});
test("grades only completed canonical game with strictly pre-tipoff model cutoff",()=>{
 const r=buildNbaCurrentGrade({canonical:[g],projections:[projection,{...projection,id:"g-late",feature_cutoff_timestamp:g.start}],gradedAt:"2026-10-25T00:00:00Z"});
 assert.equal(r.stats.gameGraded,1);
 assert.equal(r.stats.gamePreTipoffExcluded,1);
 assert.match(r.sql[0],/actual_home=112,actual_away=100/);
 assert.match(r.sql[0],/graded_at IS NULL/);
 assert.match(r.sql[0],/datetime\(feature_cutoff_timestamp\)<datetime/);
 assert.equal(r.canAuthorize,false);
});
test("grades five exact player stats including PRA from one verified final game",()=>{
 const props=["points","rebounds","assists","three_pointers_made","pra"].map((m,i)=>prop(m,"p"+i));
 const r=buildNbaCurrentGrade({canonical:[g],props});
 assert.equal(r.stats.propGraded,5);
 for(const v of [21,9,7,3,37])assert.ok(r.sql.some(x=>x.includes("actual_value="+v+",")));
});
test("does not fabricate DNP or missing individual stats or match by player name",()=>{
 const r=buildNbaCurrentGrade({canonical:[g],props:[{...prop("points"),player_id:"unknown",player_name:"A Familiar Name"},{...prop("assists","p2"),player_id:"99"},{...prop("steals","p3")}]});
 assert.equal(r.stats.unmatchedPlayer,1);
 assert.equal(r.stats.unverifiedStat,1);
 assert.equal(r.stats.propGraded,1);
});
test("rejects games without final scores and after-start projections",()=>{
 const r=buildNbaCurrentGrade({canonical:[{...g,homeScore:null}],projections:[projection],props:[prop("points")]});
 assert.equal(r.sql.length,0);
 const s=buildNbaCurrentGrade({canonical:[g],props:[{...prop("points"),feature_cutoff_timestamp:"2026-10-24T23:05:00Z"}]});
 assert.equal(s.stats.propPreTipoffExcluded,1);
});
