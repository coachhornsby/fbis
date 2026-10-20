import test from "node:test";
import assert from "node:assert/strict";
import {resolveTennisFixturePlayers} from "../functions/lib/tennisFixturePlayerLink.js";
const fixture = {id:"tennis:espn:wta:event:match",tour:"wta",away_name:"Jessica Pegula",home_name:"Jelena Ostapenko"};
function db({canonical={},bank={},aliases={}}={}) {
  return {prepare(sql) {
    const isAlias=sql.includes("FROM tennis_player_aliases");
    const rows=isAlias?aliases:sql.includes("FROM tennis_players")?canonical:bank;
    return {bind(first,second) {
      const [tour,key]=isAlias?[second,first]:[first,second];
      assert.equal(tour,"wta");
      return {async all(){return {results:rows[key]||[]};}};
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

test("a unique active alias enriches a canonical player without promoting wager authority",async()=>{
 const result=await resolveTennisFixturePlayers(db({aliases:{
  "jessica pegula":[{player_id:"wta:pegula",player_name:"J. Pegula",official_source:"WTA_OFFICIAL",alias_source:"WTA_ALIAS",current_rank:5}],
  "jelena ostapenko":[{player_id:"wta:ostapenko",player_name:"J. Ostapenko",official_source:"WTA_OFFICIAL",alias_source:"WTA_ALIAS",current_rank:20}]
 }}),fixture);
 assert.equal(result.verified,true);
 assert.equal(result.players[0].fbisPlayerId,"wta:pegula");
 assert.equal(result.players[0].identityAliasSource,"WTA_ALIAS");
 assert.equal(result.players[0].officialIdentityVerified,true);
 assert.equal(result.canAuthorizeWager,false);
});
test("multiple distinct alias targets fail closed",async()=>{
 const result=await resolveTennisFixturePlayers(db({aliases:{
  "jessica pegula":[{player_id:"one",player_name:"Alias 1"},{player_id:"two",player_name:"Alias 2"}]
 }}),fixture);
 assert.equal(result.verified,false);
 assert.equal(result.players[0].reason,"AMBIGUOUS_CANONICAL_ALIAS");
});
test("direct canonical match wins over any alias",async()=>{
 const result=await resolveTennisFixturePlayers(db({canonical:{
  "jessica pegula":[{player_id:"wta:direct",player_name:"Jessica Pegula"}]
 },aliases:{"jessica pegula":[{player_id:"wta:wrong",player_name:"Wrong"}]}}),fixture);
 assert.equal(result.players[0].fbisPlayerId,"wta:direct");
 assert.equal(result.players[0].identityAliasSource,null);
});
