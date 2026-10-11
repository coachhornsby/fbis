import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeBrandHex, safeEspnLogo, toFbsTeamProfile,
  toFbsTeamList, toTeamFeatureSummary } from "../functions/lib/cfbTeamProfiles.js";
import { loadFbsTeamDirectory, onRequestGet } from "../functions/api/cfb-teams.js";

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
   bind(...args){return {first:async()=>{
     if(sql.includes("cfb_canonical_teams"))return tables.find(x=>x.team_id===args[0]&&x.active===1&&x.subdivision==="FBS")||null;
     if(sql.includes("team_feature_snapshots")){if(missingSnapshots)throw Error("no such table");return null;}
     if(sql.includes("team_form"))return null;
     return null;
   }};},
   all:async()=>({results:tables.filter(x=>x.active===1&&x.subdivision==="FBS")}),
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
 const g=await loadFbsTeamDirectory(db,"cfb:espn:333");
 assert.equal(g.status,200); assert.equal(g.body.team.stadium.name,"Bryant-Denny Stadium");
 assert.equal(g.body.featureState.state,"PERSISTENCE_UNAVAILABLE");
 assert.equal(g.body.externalProviderRequests,0);
 assert.equal((await loadFbsTeamDirectory(db,"cfb:espn:444")).status,404);
 assert.equal((await loadFbsTeamDirectory(db,"cfb:espn:444 OR 1=1")).status,400);
 assert.ok(calls.every(x=>/^SELECT /i.test(x)));
});
test("GET handler responds as JSON, and database failures fail closed",async()=>{
 const {db}=dbMock();
 const r=await onRequestGet({env:{DB:db},request:new Request("https://fbis.test/api/cfb-teams?team=cfb%3Aespn%3A333")});
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
 assert.doesNotMatch(api,/cfbdGet|fetch\(|buildSlate|runCollegeJob|recordApiUsage/);
});