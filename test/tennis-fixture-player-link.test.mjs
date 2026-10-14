import test from "node:test";
import assert from "node:assert/strict";
import {resolveTennisFixturePlayers} from "../functions/lib/tennisFixturePlayerLink.js";
const fixture = {id:"tennis:espn:wta:event:match",tour:"wta",away_name:"Jessica Pegula",home_name:"Jelena Ostapenko"};
function db({canonical={},bank={}}={}) {
  return {prepare(sql) {
    const rows = sql.includes("FROM tennis_players") ? canonical : bank;
    return {bind(tour,key) {
      assert.equal(tour,"wta");
      return {async all() {return {results: rows[key] || []};}};
    }};
  }};
}
test("verified fixture enriches from canonical WTA bank without changing authority",async()=>{
 const result=await resolveTennisFixturePlayers(db({canonical:{
  "jessica pegula":[{player_id:"wta:pegula",player_name:"Jessica Pegula",current_rank:5,career_wins:300,career_losses:150}],
  "jelena ostapenko":[{player_id:"wta:ostapenko",player_name:"Jelena Ostapenko",current_rank:20}]
 }}),fixture);
 assert.equal(result.verified,true);
 assert.equal(result.players[0].fbisPlayerId,"wta:pegula");
 assert.equal(result.players[0].careerWins,300);
 assert.equal(result.players[1].headshotUrl,null);
 assert.equal(result.canAuthorizeWager,false);
 assert.equal(result.canQualify,false);
});
test("ATP-style missing canonical population can use supplemental identity for display only",async()=>{
 const result=await resolveTennisFixturePlayers(db({bank:{
  "jessica pegula":[{player_id:"bank:pegula",player_name:"Jessica Pegula",current_rank:7}],
  "jelena ostapenko":[{player_id:"bank:ostapenko",player_name:"Jelena Ostapenko",current_rank:18}]
 }}),fixture);
 assert.equal(result.verified,true);
 assert.equal(result.players[0].fbisPlayerId,null);
 assert.equal(result.players[0].identityAuthority,"SUPPLEMENTAL_NAME_ONLY");
 assert.equal(result.canAuthorizeWager,false);
});
test("ambiguous canonical identity fails closed rather than picking arbitrary row",async()=>{
 const result=await resolveTennisFixturePlayers(db({canonical:{
 "jessica pegula":[{player_id:"a",player_name:"Jessica Pegula"},{player_id:"b",player_name:"Jessica Pegula"}]
 }}),fixture);
 assert.equal(result.verified,false);
 assert.equal(result.players[0].reason,"AMBIGUOUS_CANONICAL_IDENTITY");
});
test("unmatched and non-singles fixtures cannot fabricate player associations",async()=>{
 assert.equal((await resolveTennisFixturePlayers(db(),fixture)).verified,false);
 assert.equal((await resolveTennisFixturePlayers(db(),{...fixture,away_name:"Jessica Pegula / Partner"})).verified,false);
});
