import test from "node:test";
import assert from "node:assert/strict";
import {buildTennisIntelligenceBank,buildIndependentTennisCards,tennisFixtureOffers} from "../functions/lib/tennisIntelligenceBank.js";
import {onRequestGet} from "../functions/api/tennis-intelligence-bank.js";
const now=new Date("2026-10-14T05:00:00Z");
const fixture={id:"tennis:espn:wta:x:y",tour:"wta",away_name:"Jessica Pegula",home_name:"Jelena Ostapenko",start:"2026-10-14T06:00:00Z",status:"SCHEDULED",source:"ESPN_PUBLIC",fetched_at:"2026-10-14T04:00:00Z",raw_hash:"sha",raw_key:"raw/fixture"};
const offer={id:"real-ledger-test-id",source:"PinnOdds",market_family:"moneyline",home_team:"Jessica Pegula",away_team:"Jelena Ostapenko",side:"home",period:"full_game",decimal_odds:1.8,event_start_time:fixture.start,collected_at:"2026-10-14T04:30:00Z",source_observed_at:null,raw_payload_json:'{"rawSnapshotKey":"raw/prices"}'};
function db({fixtures=[fixture],offers=[offer],ambiguous=false}={}) {
 return {prepare(sql){return {bind(...args){return {async all(){
  if(sql.includes("FROM tennis_external_fixtures"))return {results:fixtures};
  if(sql.includes("FROM tennis_players")) {const p={player_id:"canonical:"+args[1],player_name:args[1],current_rank:null,headshot_url:null,official_source:"WTA_OFFICIAL"};return {results:ambiguous?[p,p]:[p]};}
  if(sql.includes("FROM tennis_player_bank"))return {results:[]};
  if(sql.includes("FROM tennis_match_history"))return {results:[]};
  if(sql.includes("FROM tennis_player_profiles_current"))return {results:[{surface:"hard",profile_json:'{"historyMatches":12,"surfaceMatches":10}',last_match_date:"2026-10-10",source:"research",source_as_of:"2026-10-13",production_dependency:0}]};
  if(sql.includes("FROM normalized_market_observations"))return {results:offers};
  throw Error("UNEXPECTED_SQL");
 }}}};}};
}
test("canonical players, all surface profiles and immutable offer provenance join without betting authority",async()=>{
 const r=await buildTennisIntelligenceBank(db(),{now});
 assert.equal(r.fixtureCount,1);assert.equal(r.playerIdentityComplete,1);assert.equal(r.fixturesWithLinkedMarkets,1);
 assert.equal(r.fixtures[0].players[0].profiles[0].profile.historyMatches,12);
 assert.equal(r.fixtures[0].venueOffers[0].side,"away");
 assert.equal(r.fixtures[0].venueOffers[0].sourceObservedAt,null);
 assert.equal(r.fixtures[0].venueOffers[0].collectedAt,offer.collected_at);
 assert.equal(r.fixtures[0].venueOffers[0].rawSnapshotKey,"raw/prices");
 assert.equal(r.canAuthorizeWager,false);assert.equal(r.fixtures[0].canQualify,false);
});
test("research card flips provider home to player1, keeps probability and unknown surface unavailable",async()=>{
 const {games}=await buildIndependentTennisCards(db(),"2026-10-14",{now});
 assert.equal(games.length,1);const g=games[0];
 assert.equal(g.home.name,"Jessica Pegula");assert.equal(g.away.name,"Jelena Ostapenko");
 assert.equal(g.tennisProjection.venueOffers[0].side,"home");
 assert.equal(g.tennisProjection.player1WinProb,null);assert.equal(g.tennisProjection.surface,null);
 assert.equal(g.tennisProjection.eventIntegrity.valid,false);assert.equal(g.tennisProjection.researchFixture.verified,true);
 assert.equal(g.canQualify,false);assert.equal(g.canAuthorizeWager,false);
 assert.equal((await buildIndependentTennisCards(db(),"2026-10-13",{now})).games.length,0);
});
test("stale, future, final and raw-provenance-free fixtures fail closed",async()=>{
 for(const changes of [{fetched_at:"2026-10-12T04:00:00Z"},{fetched_at:"2026-10-15T04:00:00Z"},{status:"FINAL"},{raw_key:null},{start:"invalid"}]){
  assert.equal((await buildTennisIntelligenceBank(db({fixtures:[{...fixture,...changes}]}),{now})).fixtureCount,0);
 }
});
test("ambiguous player stays unmatched without suppressing independent schedule identity",async()=>{
 const r=await buildTennisIntelligenceBank(db({ambiguous:true}),{now});
 assert.equal(r.playerIdentityComplete,0);assert.equal(r.fixtures[0].players[0].matched,false);
 assert.deepEqual(r.fixtures[0].players[0].profiles,[]);
});
test("stale provider clock, future collection and different start cannot hydrate current offers",async()=>{
 const offers=[offer,{...offer,id:"stale",source_observed_at:"2026-10-12T00:00:00Z"},
  {...offer,id:"future",collected_at:"2026-10-15T00:00:00Z"},{...offer,id:"other-match",event_start_time:"2026-10-15T06:00:00Z"}];
 assert.deepEqual((await tennisFixtureOffers(db({offers}),fixture,{now})).map(o=>o.observationId),[offer.id]);
});
test("intelligence endpoint denies unauthenticated requests",async()=>{
 const response=await onRequestGet({request:new Request("https://example.com/api/tennis-intelligence-bank"),env:{HARVEST_SECRET:"test-secret",DB:db()}});
 assert.equal(response.status,403);
});

test("independent Tennis cards prefer approved rights-gated portrait over feed headshot",async()=>{
 const base=db();
 const verified={fbis_player_id:"tennis:wta:5678",asset_key:"tennis/portraits/tennis:wta:5678/approved.webp",
   content_type:"image/webp",approval_status:"APPROVED",public_display_allowed:1,
   display_scope:"PUBLIC_WEB",rights_evidence_ref:"licensed-test-source",
   approved_at:"2026-10-01T00:00:00Z",source_reference:"https://commons.wikimedia.org/wiki/File:Player.webp",
   attribution_text:"Approved licensed image"};
 const wrapped={prepare(sql){
   if(sql.includes("FROM tennis_player_portraits"))return {bind(...ids){return{async all(){
     return{results:ids.includes("tennis:wta:5678")?[verified]:[]};
   }}}};
   if(sql.includes("FROM tennis_players"))return {bind(tour,key){return{async all(){
     return{results:[{player_id:key==="jessica pegula"?"tennis:wta:1234":"tennis:wta:5678",
       player_name:key==="jessica pegula"?"Jessica Pegula":"Jelena Ostapenko",
       headshot_url:"https://static.prizepicks.com/images/manual/test.png",
       headshot_source:"PRIZEPICKS_FEED",official_source:"WTA_OFFICIAL"}]};
   }}}};
   return base.prepare(sql);
 }};
 const {games}=await buildIndependentTennisCards(wrapped,"2026-10-14",{now});
 assert.equal(games.length,1);
 assert.equal(games[0].away.headshotUrl,"/api/tennis-portrait?id=tennis%3Awta%3A5678");
 assert.equal(games[0].away.imageSource,"RIGHTS_VERIFIED_TENNIS_PORTRAIT");
 assert.equal(games[0].away.portraitCredit,"Approved licensed image");
 assert.equal(games[0].home.imageSource,"PRIZEPICKS_FEED");
 assert.equal(games[0].home.headshotUrl,"https://static.prizepicks.com/images/manual/test.png");
 assert.equal(games[0].tennisProjection.player1WinProb,null);
 assert.equal(games[0].canAuthorizeWager,false);
});
