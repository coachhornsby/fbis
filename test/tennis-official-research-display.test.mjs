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
  assert.match(sql,/source=\\?/);
  assert.match(sql,/LIMIT 2/);
  return {bind(...params){
   assert.ok(['atp','wta'].includes(params[0]));
   assert.equal(params[1],params[0]==='atp'?'ATP_OFFICIAL':'WTA_OFFICIAL');
   assert.equal(params[2],players[0].fbisPlayerId);
   assert.equal(params[3],players[1].fbisPlayerId);
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
 assert.equal(await lookupOfficialTennisDisplayMetadata(database([row]),{...fixture,tour:"other"},players,{now}),null);
});
test("outside time window and future-observed evidence rejected",async()=>{
 assert.equal(await lookupOfficialTennisDisplayMetadata(database([{...row,match_time:"2026-10-20T18:00:00Z"}]),fixture,players,{now}),null);
 assert.equal(await lookupOfficialTennisDisplayMetadata(database([{...row,observed_at:"2026-10-20T16:00:00Z"}]),fixture,players,{now}),null);
});

test("ATP source-backed identity can supply context without creating wagering authority",async()=>{
 const atp=[{...players[0],fbisPlayerId:"tennis:atp:1"},{...players[1],fbisPlayerId:"tennis:atp:2"}];
 const db={prepare(sql){assert.match(sql,/source=\\?/);return {bind(...v){
  assert.equal(v[0],"atp");assert.equal(v[1],"ATP_OFFICIAL");
  assert.equal(v[2],atp[0].fbisPlayerId);assert.equal(v[3],atp[1].fbisPlayerId);
  return {async all(){return {results:[{...row,source:"ATP_OFFICIAL",match_id:"atp:123"}]};}};
 };}}};
 const x=await lookupOfficialTennisDisplayMetadata(db,{...fixture,tour:"atp"},atp,{now});
 assert.equal(x.source,"ATP_OFFICIAL");
 assert.equal(x.displayOnly,true);
 assert.equal(x.canQualify,false);
 assert.equal(x.canAuthorizeWager,false);
});
