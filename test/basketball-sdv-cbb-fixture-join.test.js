import test from "node:test";
import assert from "node:assert/strict";
import {matchCbbNcaaPossessionsToEspnFixture} from "../functions/lib/basketballSdvCbbFixtureJoin.js";
const row={gameId:"10258",season:2026,
 ncaaSchedule:{contest_id:"10258",game_date:"2026-01-31",home_score:78,away_score:72},
 firstPossession:{contest_id:"10258",espn_game_id:"401900123",
  home_espn_team_id:"12",away_espn_team_id:"22"},
 espnFixture:{id:401900123,season:2026,time_valid:true,status_type_completed:true,
  format_regulation_periods:2,home_id:12,away_id:22,home_score:78,away_score:72,
  game_date_time:"2026-01-31T19:00:00-05:00"},
 fixtureSourceFingerprint:"e".repeat(64)};
test("Independent ESPN CBB schedule verifies NCAA game identity and exact Eastern-zone tipoff",()=>{
 const r=matchCbbNcaaPossessionsToEspnFixture(row);
 assert.equal(r.status,"INDEPENDENT_CBB_ESPN_EXACT_TIPOFF");
 assert.equal(r.tipoff,"2026-02-01T00:00:00.000Z");
 assert.equal(r.evidence.gameId,"10258");
 assert.equal(r.evidence.espnGameId,"401900123");
});
test("No guessed start for missing ESPN crosswalk or unknown time validity",()=>{
 const a=matchCbbNcaaPossessionsToEspnFixture({...row,
  firstPossession:{...row.firstPossession,espn_game_id:"NA"}});
 assert.equal(a.tipoff,null);
 const b=matchCbbNcaaPossessionsToEspnFixture({...row,
  espnFixture:{...row.espnFixture,time_valid:false}});
 assert.equal(b.status,"CBB_ESPN_FIXTURE_NOT_FINAL_OR_TIME_UNVERIFIED");
});
test("Disagreeing verified ESPN result or swapped team IDs fail closed",()=>{
 const a=matchCbbNcaaPossessionsToEspnFixture({...row,
  espnFixture:{...row.espnFixture,home_score:80}});
 assert.equal(a.status,"CBB_INDEPENDENT_OFFICIAL_SCORES_MISMATCH");
 const b=matchCbbNcaaPossessionsToEspnFixture({...row,
  espnFixture:{...row.espnFixture,home_id:22}});
 assert.equal(b.status,"CBB_HOME_AWAY_ESPN_ID_MISMATCH");
});
test("CBB OT format and timezone/date conflict cannot be admitted",()=>{
 const a=matchCbbNcaaPossessionsToEspnFixture({...row,
  espnFixture:{...row.espnFixture,format_regulation_periods:4}});
 assert.equal(a.tipoff,null);
 const b=matchCbbNcaaPossessionsToEspnFixture({...row,
  espnFixture:{...row.espnFixture,game_date_time:"2026-02-09T12:00:00-05:00"}});
 assert.equal(b.status,"CBB_NCAA_VS_ESPN_DATE_MISMATCH");
});
