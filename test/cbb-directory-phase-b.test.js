import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("CBB Phase B schema is research/SHADOW only",()=>{
 const s=readFileSync("migrations/0084_cbb_directory_phase_b.sql","utf8");
 assert.match(s,/FBIS-STATE-OVERLAY-v1/);
 assert.match(s,/DEFAULT 'SHADOW'/);
 assert.doesNotMatch(s,/can_influence_projection[^\n]*DEFAULT 1/i);
 assert.match(s,/CHECK\(status IN \('AVAILABLE','QUESTIONABLE','DOUBTFUL','OUT','SUSPENDED','UNKNOWN'\)\)/);
 assert.match(s,/future_membership_leaks/);
 assert.match(s,/post_tip_observations/);
});
test("CBB Phase B builder never infers availability from DNP or minutes",()=>{
 const s=readFileSync("scripts/cbb-directory-phase-b.mjs","utf8");
 assert.match(s,/availability:"UNKNOWN"/);
 assert.match(s,/explicit verified status source/);
 assert.doesNotMatch(s,/didNotPlay.*availability|minutes.*availability|DNP.*OUT/i);
 assert.match(s,/prior-season baseline only when provider team matches current roster team/);
});
test("CBB Phase B excludes totals challengers",()=>{
 const s=readFileSync("migrations/0084_cbb_directory_phase_b.sql","utf8");
 const defs=[...s.matchAll(/'cbb-shadow-[^']+','([^']+)','([^']+)'/g)].map(x=>x[1]);
 assert.ok(defs.length>=10);
 assert.equal(defs.includes("TOTALS"),false);
});

test("runtime Phase B uses bounded CBBD sources and daily idempotency",()=>{
 const s=readFileSync("functions/lib/cbbDirectoryPhaseB.js","utf8");
 assert.match(s,/cbbdGet\("\/teams\/roster"/);
 assert.match(s,/cbbdGet\("\/teams"/);
 assert.match(s,/cbbdGet\("\/games"/);
 assert.match(s,/cbbdGet\("\/stats\/player\/season"/);
 assert.match(s,/already_complete/);
 assert.match(s,/prior-season baseline only when provider identity and team match verified current roster/);
 assert.match(s,/UNKNOWN absent explicit verified status source/);
 assert.match(s,/futureMembershipLeaks:0/);
 assert.match(s,/totalsDefinitions:0/);
});

test("migration 0084 records Phase B checkpoints",()=>{
 const s=readFileSync("migrations/0084_cbb_directory_phase_b.sql","utf8");
 assert.match(s,/CREATE TABLE IF NOT EXISTS cbb_directory_phase_b_runs/);
 assert.match(s,/0084_cbb_directory_phase_b/);
});
