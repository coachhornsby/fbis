import test from "node:test";
import assert from "node:assert/strict";
import { getProTeamDirectory, resolveProTeam, parseProRoster, matchProRosterPlayer, loadProTeamRoster } from "../functions/lib/proTeamDirectory.js";
import { onRequestGet } from "../functions/api/pro-team-directory.js";

test("all 94 NFL NBA NHL teams are exposed without duplicate abbreviations", () => {
  for(const [sport,count] of [["nfl",32],["nba",30],["nhl",32]]){
    const teams=getProTeamDirectory(sport);
    assert.equal(teams.length,count,sport);
    assert.equal(new Set(teams.map(t=>t.abbr)).size,count);
    assert.ok(teams.every(t=>t.logo && t.name && t.id));
  }
  assert.equal(getProTeamDirectory("soccer"),null);
  assert.equal(resolveProTeam("nhl","LA").abbr,"LA");
  assert.equal(resolveProTeam("nhl","LAK").abbr,"LA");
  assert.equal(resolveProTeam("nhl","TB").abbr,"TB");
  assert.equal(resolveProTeam("nhl","TBL").abbr,"TB");
  assert.equal(resolveProTeam("nfl","no-such-team"),null);
});
test("ESPN NFL/NBA roster parsing uses provider-specific athlete IDs and verified image host", () => {
  const fixture = {athletes:[{position:"QB",items:[
    {id:"123",displayName:"Example Player",position:{abbreviation:"QB"},jersey:"13",headshot:{href:"https://a.espncdn.com/i/headshots/nfl/players/full/123.png"}},
    {id:"123",displayName:"Example Player"},
    {id:"124",displayName:"Second Player",position:{abbreviation:"RB"},headshot:{href:"https://untrusted.example/portrait.png"}}
  ]}]};
  const nfl=parseProRoster("nfl",fixture);
  assert.equal(nfl.length,2);
  assert.equal(nfl[0].playerKey,"espn:nfl:123");
  assert.equal(nfl[0].headshotSource,"ESPN_ROSTER");
  assert.equal(nfl[1].headshotSource,"ESPN_ID_CDN_CANDIDATE");
  assert.equal(nfl[1].headshotUrl,"https://a.espncdn.com/i/headshots/nfl/players/full/124.png");
  assert.equal(matchProRosterPlayer(nfl,"EXAMPLE PLAYER").id,"123");
  assert.equal(matchProRosterPlayer(nfl,"some other player"),null);
  const nba=parseProRoster("nba",{athletes:[{id:"555",displayName:"Basketball Player",position:{abbreviation:"G"}}]});
  assert.equal(nba[0].playerKey,"espn:nba:555");
});
test("NHL roster parsing preserves official ID and portrait with no bookmaker market data", () => {
  const rows=parseProRoster("nhl",{forwards:[{id:8478402,firstName:{default:"Test"},lastName:{default:"Forward"},headshot:"https://assets.nhle.com/mugs/nhl/20262027/TOR/8478402.png",positionCode:"C",sweaterNumber:34}],defensemen:[],goalies:[]});
  assert.equal(rows.length,1);
  assert.equal(rows[0].name,"Test Forward");
  assert.equal(rows[0].playerKey,"nhl:8478402");
  assert.equal(rows[0].headshotSource,"NHL_OFFICIAL_ROSTER");
  assert.equal(rows[0].headshotUrl,"https://assets.nhle.com/mugs/nhl/20262027/TOR/8478402.png");
  assert.equal("marketAvailable" in rows[0],false);
});
test("roster API fails closed on upstream errors and empty feeds",async()=>{
  let requested="";
  const load=()=>loadProTeamRoster({sport:"nhl",team:"TOR",fetcher:async url=>{
    requested=url;return {ok:true,json:async()=>({forwards:[{id:1,firstName:{default:"A"},lastName:{default:"Player"}}]})};
  }});
  const good=await load();
  assert.equal(good.ok,true);
  assert.ok(requested.endsWith("/roster/TOR/current"));
  assert.equal(good.players.length,1);
  const empty=await loadProTeamRoster({sport:"nba",team:"ATL",fetcher:async()=>({ok:true,json:async()=>({athletes:[]})})});
  assert.equal(empty.ok,false);
  const unavailable=await loadProTeamRoster({sport:"nfl",team:"ARI",fetcher:async()=>({ok:false,status:429})});
  assert.equal(unavailable.ok,false);
  assert.equal(unavailable.error,"upstream-roster-http-429");
  assert.equal((await loadProTeamRoster({sport:"nba",team:"FAKE"})).status,400);
});
test("directory API surfaces 30 NBA teams and rejects unsupported leagues",async()=>{
  const good=await onRequestGet({request:new Request("https://fbis.test/api/pro-team-directory?sport=nba")});
  assert.equal(good.status,200);
  const payload=await good.json();
  assert.equal(payload.teams.length,30);
  const bad=await onRequestGet({request:new Request("https://fbis.test/api/pro-team-directory?sport=other")});
  assert.equal(bad.status,400);
});
