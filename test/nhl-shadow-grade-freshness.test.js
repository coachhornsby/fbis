import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newerPrefixSourceTimestamp } from "../functions/lib/sportWorkingCopy.js";
const source=readFileSync(new URL("../functions/lib/sportWorkingCopy.js",import.meta.url),"utf8");
test("NHL grading must be replayed even when goalie-probability-shadow counts match",()=>{
 assert.match(source,/nhl_goalie_probability_shadow: "graded_at"/);
 assert.match(source,/SELECT MAX\(\$\{freshnessColumn\}\) AS latest FROM/);
 assert.equal(newerPrefixSourceTimestamp("2026-10-22T03:17:29.031Z","2026-10-21T18:41:36.534Z"),true);
 assert.equal(newerPrefixSourceTimestamp("2026-10-22T03:17:29.031Z","2026-10-22T03:17:29.031Z"),false);
});
