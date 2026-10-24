import test from "node:test";
import assert from "node:assert/strict";
import {nbaCanonicalFixtureEvidence,matchNbaStatsScheduleToCanonical} from "../functions/lib/basketballSdvFixtureJoin.js";
const raw=[
 {id:"401",start:"2026-02-01T01:30:00Z",home:{abbr:"BOS"},away:{abbr:"NYK"},homeScore:115,awayScore:104},
 {id:"402",start:"2026-02-04T02:30:00Z",home:{abbr:"BOS"},away:{abbr:"NYK"},homeScore:119,awayScore:102}
].map(JSON.stringify).join("\n")+"\n";
const schedule={game_id:"0022500001",game_date:"2026-01-31",
 home_team_abbreviation:"BOS",away_team_abbreviation:"NYK",
 home_pts:115,away_pts:104};
test("NBA original provider schedule joins one immutable independently scored ESPN event",()=>{
 const lib=nbaCanonicalFixtureEvidence(raw);
 const r=matchNbaStatsScheduleToCanonical(schedule,lib,{statsGameId:"0022500001"});
 assert.equal(r.status,"INDEPENDENT_CANONICAL_EXACT_TIPOFF");
 assert.equal(r.tipoff,"2026-02-01T01:30:00.000Z");
 assert.equal(r.evidence.espnGameId,"401");
 assert.equal(r.evidence.verified,true);
 assert.equal(r.evidence.sourceFingerprint.length,64);
});
test("NBA matching rejects score mismatch and ambiguous physical events",()=>{
 const lib=nbaCanonicalFixtureEvidence(raw);
 const wrong=matchNbaStatsScheduleToCanonical({...schedule,home_pts:110},lib,
  {statsGameId:"0022500001"});
 assert.equal(wrong.tipoff,null);
 const doubled=nbaCanonicalFixtureEvidence(raw+JSON.stringify({
  id:"403",start:"2026-01-31T23:30:00Z",home:{abbr:"BOS"},away:{abbr:"NYK"},
  homeScore:115,awayScore:104})+"\n");
 const ambiguous=matchNbaStatsScheduleToCanonical(schedule,doubled,{statsGameId:"0022500001"});
 assert.equal(ambiguous.status,"AMBIGUOUS_CANONICAL_MATCH");
});
test("No imported canonical NBA fixture means no manufactured tipoff",()=>{
 const lib=nbaCanonicalFixtureEvidence(raw);
 assert.equal(matchNbaStatsScheduleToCanonical({...schedule,away_team_abbreviation:"MIA"},
  lib,{statsGameId:"0022500001"}).tipoff,null);
 assert.equal(matchNbaStatsScheduleToCanonical({...schedule,game_id:"other"},
  lib,{statsGameId:"0022500001"}).tipoff,null);
});
