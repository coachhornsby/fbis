import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Phase B runtime uses production secret binding without exposing bearer",()=>{
 const s=readFileSync("functions/api/cbb-directory-phase-b-runtime.js","utf8");
 assert.match(s,/CFBD_API_KEY/);
 assert.match(s,/CBBD_API_KEY/);
 assert.doesNotMatch(s,/Bearer\s+[A-Za-z0-9._-]{8,}/);
});
test("Phase B runtime preserves UNKNOWN availability and prior-team match rule",()=>{
 const s=readFileSync("functions/lib/cbbDirectoryPhaseBRuntime.js","utf8");
 assert.match(s,/availability:"UNKNOWN"/);
 assert.match(s,/provider team must match verified current roster team/);
 assert.doesNotMatch(s,/didNotPlay.*OUT|minutes.*OUT|DNP.*OUT/i);
 assert.match(s,/futureAvailabilityLeakage:0/);
});
test("Phase B runtime derives current season through FBIS season boundary",()=>{
 const s=readFileSync("functions/lib/cbbDirectoryPhaseBRuntime.js","utf8");
 assert.match(s,/cbbSeasonYear\(asOf\)/);
 assert.doesNotMatch(s,/season=2027|FBIS_CBB_SEASON\|\|2027/);
});
