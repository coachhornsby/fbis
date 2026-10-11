import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeBrandHex, safeEspnLogo, toFbsTeamProfile,
  toFbsTeamList, toTeamFeatureSummary } from "../functions/lib/cfbTeamProfiles.js";
import { loadFbsTeamDirectory, onRequestGet } from "../functions/api/cfb-teams.js";
import {toRosterProfiles,rosterProfile,teamSchedule,normalizeStats,statSnapshot} from "../functions/lib/cfbTeamStatProfile.js";
import {loadFbsTeamSeasonEvidence} from "../functions/lib/cfbTeamSeasonEvidence.js";

const emptyPublic=async()=>({schedule:{state:"AVAILABLE",games:[],count:0},apRanking:{state:"AVAILABLE",rank:null}});
const sample = (overrides = {}) => ({
  team_id:"cfb:espn:333", school_name:"Alabama", athletic_name:"Crimson Tide",
  abbreviation:"ALA", active:1, subdivision:"FBS", current_conference:"SEC",
  city:"Tuscaloosa", state:"AL", home_stadium:"Bryant-Denny Stadium",
  latitude:33.2082752, longitude:-87.5503836, timezone:"America/Chicago",
  last_observed_at:"2026-10-06T14:30:02Z",
  source_json:JSON.stringify({
    season:2026,display_name:"Alabama Crimson Tide",mascot:"Crimson Tide",
    color:"9e1b32",alternate_color:"ffffff",
    team_logo:"https://a.espncdn.com/i/teamlogos/ncaa/500/333.png",
    team_logo_dark:"https://a.espncdn.com/i/teamlogos/ncaa/500-dark/333.png",
    venue_id:3657,venue_name:"Bryant-Denny Stadium",venue_city:"Tuscaloosa",
    venue_state:"AL",capacity:101821,dome:false,grass:true,elevation:70.05,
  }),...overrides,
});
test("Only active confirmed FBS profiles can appear; FCS and historical inactive excluded",()=>{
  assert.equal(toFbsTeamProfile(sample({subdivision:"FCS"})),null);
  assert.equal(toFbsTeamProfile(sample({subdivision:"UNKNOWN"})),null);
  assert.equal(toFbsTeamProfile(sample({active:0})),null);
  assert.equal(toFbsTeamList([sample(),sample({subdivision:"FCS"})]).length,1);
});
test("Branding colors and image URLs are allowlisted; no false official verification",()=>{
  const t=toFbsTeamProfile(sample());
  assert.deepEqual([t.colors.primary,t.colors.secondary],["#9E1B32","#FFFFFF"]);
  assert.equal(t.logo.url,"https://a.espncdn.com/i/teamlogos/ncaa/500/333.png");
  assert.equal(t.logo.darkUrl,"https://a.espncdn.com/i/teamlogos/ncaa/500-dark/333.png");
  assert.equal(t.mascot.teamNickname,"Crimson Tide");
  assert.equal(t.mascot.costumedCharacter,null);
  assert.equal(t.logo.officialVerified,false);
  assert.equal(t.colors.officialVerified,false);
  assert.equal(t.modelAuthority.canInfluenceProjection,false);
  for(const v of ["url(javascript:alert(1))","red","abc","12345678"])assert.equal(safeBrandHex(v),null);
  assert.equal(safeBrandHex("#041e42"),"#041E42");
  for(const u of ["http://a.espncdn.com/i/teamlogos/ncaa/500/333.png",
     "https://evil.com/i/teamlogos/ncaa/500/333.png",
     "https://a.espncdn.com.evil.com/i/teamlogos/ncaa/500/333.png",
     "javascript:alert(1)"]) assert.equal(safeEspnLogo(u),null);
});
test("Coordinates are preserved as stored and linked without false geospatial accuracy",()=>{
 const a=toFbsTeamProfile(sample());
 assert.equal(a.stadium.name,"Bryant-Denny Stadium");
 assert.equal(a.stadium.latitude,33.2082752);
 assert.equal(a.stadium.longitude,-87.5503836);
 assert.equal(a.stadium.coordinatesAvailable,true);
 assert.equal(a.stadium.coordinateVerified,false);
 assert.match(a.stadium.mapUrl,/33\.2082752/);
 const missing=toFbsTeamProfile(sample({latitude:null,longitude:null,
    source_json:JSON.stringify({color:"000000",latitude:"no",longitude:200})}));
 assert.equal(missing.stadium.mapUrl,null);
 assert.equal(missing.stadium.coordinatesAvailable,false);
});
test("Feature-state availability never manufactures numbers or grants model authority",()=>{
 const missing=toTeamFeatureSummary();
 assert.equal(missing.state,"NOT_POPULATED");
 assert.equal(missing.features,null);
 const saved=toTeamFeatureSummary({as_of:"2026-10-07T00:00:00Z",
  feature_version:"cfb-features-v1",features_json:'{"offense":{"ppa":0.1}}',
  missingness_json:'{"defense":true}'});
 assert.equal(saved.state,"RESEARCH_SNAPSHOT");
 assert.equal(saved.features.offense.ppa,0.1);
 assert.equal(saved.canInfluenceProjection,false);
});
function dbMock({tables=[sample(),sample({team_id:"cfb:espn:444",subdivision:"FCS"})],
  missingSnapshots=true,failed=false}={}) {
 let calls=[];
 const db={prepare(sql){
  calls.push(sql);
  if(failed)throw Error("DB inaccessible");
  if(/INSERT|UPDATE|DELETE|REPLACE|fetch/i.test(sql))throw Error("WRITE OR PROVIDER NOT ALLOWED");
  return {
   bind(...args){return {all:this.all,first:async()=>{
     if(sql.includes("cfb_canonical_teams"))return tables.find(x=>x.team_id===args[0]&&x.active===1&&x.subdivision==="FBS")||null;
     if(sql.includes("team_feature_snapshots")){if(missingSnapshots)throw Error("no such table");return null;}
     if(sql.includes("team_form"))return null;
     return null;
   }};},
   all:async()=>{
     if(sql.includes("cfb_roster_membership"))return {results:[]};
     if(sql.includes("games WHERE"))return {results:[]};
     if(sql.includes("cfb_team_season_stat_snapshots")||sql.includes("cfb_player_season_stat_snapshots"))throw Error("no such table");
     return {results:tables.filter(x=>x.active===1&&x.subdivision==="FBS")};
   },
  };
 }};
 return {db,calls};
}
test("List endpoint queries persistent FBS identities only and performs zero acquisitions or writes",async()=>{
 const {db,calls}=dbMock();
 const r=await loadFbsTeamDirectory(db);
 assert.equal(r.status,200);
 assert.equal(r.body.count,1);
 assert.deepEqual(r.body.teams.map(x=>x.teamId),["cfb:espn:333"]);
 assert.equal(r.body.externalProviderRequests,0);
 assert.equal(r.body.modelAuthority.canInfluenceProjection,false);
 assert.ok(calls.every(x=>/^SELECT /i.test(x)));
});
test("Single team endpoint blocks FCS, unverified IDs and reports missing feature persistence",async()=>{
 const {db,calls}=dbMock();
 const g=await loadFbsTeamDirectory(db,"cfb:espn:333",{publicFactsLoader:emptyPublic});
 assert.equal(g.status,200); assert.equal(g.body.team.stadium.name,"Bryant-Denny Stadium");
 assert.equal(g.body.featureState.state,"PERSISTENCE_UNAVAILABLE");
 assert.equal(g.body.externalProviderRequests,2);
 assert.equal((await loadFbsTeamDirectory(db,"cfb:espn:444",{publicFactsLoader:emptyPublic})).status,404);
 assert.equal((await loadFbsTeamDirectory(db,"cfb:espn:444 OR 1=1",{publicFactsLoader:emptyPublic})).status,400);
 assert.ok(calls.every(x=>/^SELECT /i.test(x)));
});
test("GET handler responds as JSON, and database failures fail closed",async()=>{
 const {db}=dbMock();
 const r=await onRequestGet({env:{DB:db},publicFactsLoader:emptyPublic,request:new Request("https://fbis.test/api/cfb-teams?team=cfb%3Aespn%3A333")});
 assert.equal(r.status,200);
 assert.equal((await r.json()).team.school,"Alabama");
 assert.equal((await loadFbsTeamDirectory(dbMock({failed:true}).db)).status,503);
 assert.equal((await loadFbsTeamDirectory(null)).status,503);
});
test("Navigation keeps Team Profiles separate from game slates and wager authority",()=>{
 const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
 assert.match(app,/route === "teams"/);
 assert.match(app,/<CfbTeamsView refreshKey=/);
 const api=readFileSync(new URL("../functions/api/cfb-teams.js",import.meta.url),"utf8");
 assert.doesNotMatch(api,/cfbdGet|buildSlate|runCollegeJob|recordApiUsage/);
});

test("All-position roster preserves actual membership, physical attributes and zero projection authority",()=>{
 const players=toRosterProfiles([
  {player_id:"cfb:espn-player:1",canonical_name:"Receiver One",position:"Wide Receiver",position_abbreviation:"WR",
   jersey:"5",class_year:"Junior",height:73,weight:195,season:2026,source:"SDV",games_rostered:5,
   observed_at:"2026-10-06T12:00:00Z"},
  {player_id:"cfb:espn-player:2",canonical_name:"Defender Two",position:"Linebacker",position_abbreviation:"LB",
   jersey:"42",class_year:"Senior",height:74,weight:228,season:2026,source:"SDV",games_rostered:4},
  {player_id:"cfb:espn-player:2",canonical_name:"Defender Two",position_abbreviation:"LB",season:2026},
  {player_id:null,canonical_name:null},
 ]);
 assert.deepEqual(players.map(r=>r.position),["WR","LB"]);
 assert.equal(players.length,2);
 assert.equal(players[0].heightInches,73);
 assert.equal(players[1].gamesRostered,4);
 assert.equal(players[0].performanceAuthority,false);
 assert.equal(rosterProfile({games_rostered:0}).gamesRostered,0);
});
test("Complete stored team and player stats preserve zeros and source timestamps, not missing-as-zero",()=>{
 const metrics=normalizeStats(JSON.stringify({offense:{EPA_play:0,plays:57.5,unknown:null},
   defense:{havocRate:0.12},passing:{yards:"274"},rushing:{yards:""},
   total:"10"}));
 assert.equal(metrics.offense.EPA_play,0);
 assert.equal(metrics.offense.plays,57.5);
 assert.equal(metrics.defense.havocRate,0.12);
 assert.equal(metrics.passing.yards,274);
 assert.equal(metrics.rushing.yards,undefined);
 assert.equal(metrics.other.total,10);
 const snap=statSnapshot({metrics_json:JSON.stringify({passing:{yards:274}}),
   source:"SPORTSDATAVERSE_ESPN",source_timestamp:"2026-10-07T00:00:00Z",
   observed_at:"2026-10-07T01:00:00Z",season:2026});
 assert.equal(snap.state,"SOURCE_OBSERVED");
 assert.equal(snap.metricsCount,1);
 assert.equal(snap.canInfluenceProjection,false);
 assert.equal(statSnapshot().metricsCount,0);
});
test("Dated game fixture mapping has no manufactured results or final scores",()=>{
 const games=teamSchedule([{id:"g1",date:"2026-10-10",start:"2026-10-10T18:00:00Z",
   home_name:"Alabama",away_name:"Georgia",away_abbr:"UGA"},
  {id:"g2",date:"2026-09-12",home_name:"Georgia",away_name:"Alabama"},
  {id:"g3",home_name:"Auburn",away_name:"Georgia"}],
  {school:"Alabama",displayName:"Alabama Crimson Tide"});
 assert.equal(games.length,2);
 assert.deepEqual(games.map(g=>g.location),["HOME","AWAY"]);
 assert.ok(games.every(g=>g.result===null&&g.pointsFor===null&&g.verifiedResult===false));
});
test("FBS season evidence returns saved complete rosters and all stat groups without acquisition",async()=>{
 const sqls=[];
 const db={prepare(sql){
  sqls.push(sql);
  assert.match(sql,/^SELECT /i);
  return {bind(...params){return {all:async()=>{
    if(sql.includes("FROM cfb_roster_membership m"))return {results:[
      {player_id:"cfb:espn-player:12",canonical_name:"Real Player",
       position:"Quarterback",position_abbreviation:"QB",jersey:"12",
       class_year:"Senior",height:74,weight:200,season:2026}]};
    if(sql.includes("SELECT DISTINCT season"))return {results:[{season:2026},{season:2025}]};
    if(sql.includes("FROM games WHERE"))return {results:[
      {id:"g1",date:"2026-10-10",home_name:"Alabama Crimson Tide",away_name:"Georgia"}]};
    if(sql.includes("FROM cfb_team_season_stat_snapshots"))return {results:[
      {metrics_json:'{"offense":{"epaPlay":0.22},"defense":{"successAllowed":0.36}}',
       source:"SDV",source_timestamp:"2026-10-09T02:00:00Z",observed_at:"2026-10-09T03:00:00Z",
       season:2026}]};
    if(sql.includes("FROM cfb_player_season_stat_snapshots"))return {results:[
      {player_id:"cfb:espn-player:12",metrics_json:'{"passing":{"yards":1550,"td":13}}',
       source:"SDV",season:2026}]};
    if(sql.includes("FROM cfb_player_game_stat_observations"))return {results:[
      {player_id:"cfb:espn-player:12",game_id:"g1",game_at:"2026-10-01",
       opponent:"Georgia",metrics_json:'{"passing":{"yards":255}}',source:"SDV",season:2026}]};
    throw Error("Unexpected SQL");
  }};}};
 }};
 const e=await loadFbsTeamSeasonEvidence(db,{teamId:"cfb:espn:333",school:"Alabama",
  displayName:"Alabama Crimson Tide"},2026,"cfb:espn-player:12");
 assert.equal(e.roster.count,1);
 assert.equal(e.roster.players[0].name,"Real Player");
 assert.equal(e.roster.players[0].position,"QB");
 assert.equal(e.schedule.count,1);
 assert.equal(e.teamStatistics.groups.offense.epaPlay,0.22);
 assert.equal(e.playerStatistics.byPlayer["cfb:espn-player:12"].groups.passing.yards,1550);
 assert.equal(e.playerGameStatistics.rows[0].groups.passing.yards,255);
 assert.deepEqual(e.availableSeasons,[2026,2025]);
 assert.ok(sqls.every(sql=>!/\b(INSERT|UPDATE|DELETE)\b/i.test(sql)));
});
test("Missing statistical tables keep rosters visible without inventing season statistics",async()=>{
 const {db}=dbMock();
 const result=await loadFbsTeamDirectory(db,"cfb:espn:333",{season:2026,publicFactsLoader:emptyPublic});
 assert.equal(result.status,200);
 assert.equal(result.body.evidence.teamStatistics.state,"NO_VERIFIED_STATS");
 assert.equal(result.body.evidence.teamStatistics.storageState,"NOT_POPULATED");
 assert.equal(result.body.evidence.playerStatistics.availableCount,0);
 assert.equal(result.body.evidence.roster.count,0);
 assert.equal((await loadFbsTeamDirectory(db,"cfb:espn:333",{season:2030,publicFactsLoader:emptyPublic})).status,400);
 assert.equal((await loadFbsTeamDirectory(db,"cfb:espn:333",{playerId:"x' OR 1=1"})).status,400);
});
test("Team page exposes both all-player roster and grouped actual stat sections",()=>{
 const page=readFileSync(new URL("../src/features/cfbTeams/CfbTeamsView.jsx",import.meta.url),"utf8");
 for(const label of ["Season team statistics","team rosters","Individual season statistics",
  "Individual game statistics","Season games and opponents"])
   assert.ok(page.includes(label),label);
 assert.match(page,/source-observed|Source:/i);
});
