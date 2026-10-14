import test from "node:test";
import assert from "node:assert/strict";
import {buildTennisIntelligenceBank} from "../functions/api/tennis-intelligence-bank.js";
const fixture={id:"tennis:espn:wta:x:y",tour:"wta",away_name:"Jessica Pegula",home_name:"Jelena Ostapenko",start:"2026-10-14T06:00:00Z",status:"SCHEDULED",source:"ESPN_PUBLIC"};
function db(){
 return {prepare(sql){return{bind(...args){return{async all(){
  if(sql.includes("FROM tennis_external_fixtures"))return {results:[fixture]};
  if(sql.includes("FROM tennis_players"))return {results:[{player_id:"canonical:"+args[1],player_name:args[1],current_rank:null,headshot_url:null}]};
  if(sql.includes("FROM tennis_player_bank"))return{results:[]};
  if(sql.includes("FROM tennis_player_profiles_current"))return{results:[{surface:"hard",profile_json:'{"historyMatches":12}',last_match_date:"2026-10-10",source:"research",source_as_of:"2026-10-13",production_dependency:0}]};
  if(sql.includes("FROM normalized_market_observations"))return {results:[{source:"PinnOdds",market_family:"moneyline",observations:2,last_collected:"2026-10-14T04:00:00Z"}]};
  throw Error("UNEXPECTED_SQL");
 }}}}};
}
test("player bank joins fixture to canonical players and surface profiles without wagering authority",async()=>{
 const result=await buildTennisIntelligenceBank(db());
 assert.equal(result.fixtureCount,1);
 assert.equal(result.playerIdentityComplete,1);
 assert.equal(result.fixturesWithLinkedMarkets,1);
 assert.equal(result.fixtures[0].players[0].profiles[0].profile.historyMatches,12);
 assert.equal(result.canAuthorizeWager,false);
 assert.equal(result.fixtures[0].canQualify,false);
});
