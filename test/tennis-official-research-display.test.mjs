import test from "node:test";
import assert from "node:assert/strict";
import {lookupOfficialTennisDisplayMetadata} from "../functions/lib/tennisIntelligenceBank.js";

const start="2026-10-20T15:00:00.000Z";
const fixture={id:"tennis:espn:wta:test",tour:"wta",start};
const players=[
 {fbisPlayerId:"tennis:wta:1",officialIdentityVerified:true},
 {fbisPlayerId:"tennis:wta:2",officialIdentityVerified:true}
];
const row={match_id:"wta:official:1",source:"WTA_OFFICIAL",match_time:start,
 observed_at:"2026-10-20T13:00:00.000Z",tournament_name:"Verified event",
 surface:"hard",round_code:"R32",venue:"Court 1"};
function database(rows){
 return {prepare(sql){
  assert.match(sql,/FROM tennis_official_matches/);
  assert.match(sql,/source='WTA_OFFICIAL'/);
  assert.match(sql,/LIMIT 2/);
  return {bind(...params){
   assert.equal(params[0],players[0].fbisPlayerId);
   assert.equal(params[1],players[1].fbisPlayerId);
   return {async all(){return {results:rows}}};
  }};
 }};
}
const now=new Date("2026-10-20T14:00:00.000Z");
test("exact WTA pairing yields display-only metadata, never wager authority",async()=>{
 const x=await lookupOfficialTennisDisplayMetadata(database([row]),fixture,players,{now});
 assert.equal(x.tournament,"Verified event");
 assert.equal(x.surface,"hard");
 assert.equal(x.venue,"Court 1");
 assert.equal(x.displayOnly,true);
 assert.equal(x.canQualify,false);
 assert.equal(x.canAuthorizeWager,false);
});
test("ambiguous official pair, unverified player and wrong tour fail closed",async()=>{
 assert.equal(await lookupOfficialTennisDisplayMetadata(database([row,row]),fixture,players,{now}),null);
 assert.equal(await lookupOfficialTennisDisplayMetadata(database([row]),fixture,[players[0],{...players[1],officialIdentityVerified:false}],{now}),null);
 assert.equal(await lookupOfficialTennisDisplayMetadata(database([row]),{...fixture,tour:"atp"},players,{now}),null);
});
test("outside time window and future-observed evidence rejected",async()=>{
 assert.equal(await lookupOfficialTennisDisplayMetadata(database([{...row,match_time:"2026-10-20T18:00:00Z"}]),fixture,players,{now}),null);
 assert.equal(await lookupOfficialTennisDisplayMetadata(database([{...row,observed_at:"2026-10-20T16:00:00Z"}]),fixture,players,{now}),null);
});
