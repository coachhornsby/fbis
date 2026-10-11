import test from "node:test";
import assert from "node:assert/strict";
import {independentNflPlayerProjections} from "../functions/api/nfl-mirror-projections.js";

test("publishes independent NFL player projections even without paid PrizePicks rows",()=>{
 const result=independentNflPlayerProjections({games:[{
  id:"nfl-game-1",start:"2099-10-11T20:00:00Z",
  playerProjectionStatus:{version:"NFL-PLAYER-RESEARCH"},
  playerProjectionRows:[
   {playerName:"Brock Purdy",market:"passing_yards",fbisProjection:242.6,source:"NFL_MODEL"},
   {playerName:"George Kittle",market:"receptions",fbisProjection:4.2},
  ],
 }]});
 assert.equal(result.rows.length,2);
 assert.equal(result.rows[0].fbis_projection,242.6);
 assert.equal(result.rows[0].wagering_authorized,false);
 assert.equal(result.rows[0].model_version,"NFL-PLAYER-RESEARCH");
});

test("refuses missing, nonfinite, ambiguous and started projections",()=>{
 const result=independentNflPlayerProjections({games:[
  {id:"a",start:"2099-10-11T20:00:00Z",playerProjectionRows:[{playerName:"A Player",market:"passing_yards",fbisProjection:220},{playerName:"No Data",market:"receptions",fbisProjection:null},{playerName:"Bad Data",market:"rushing_yards",fbisProjection:"not-a-number"}]},
  {id:"b",start:"2099-10-11T23:00:00Z",playerProjectionRows:[{playerName:"A Player",market:"passing_yards",fbisProjection:230}]},
  {id:"old",start:"2020-10-11T20:00:00Z",playerProjectionRows:[{playerName:"Old Player",market:"passing_yards",fbisProjection:200}]}
 ]});
 assert.equal(result.rows.length,0);
 assert.equal(result.ambiguous,1);
});
