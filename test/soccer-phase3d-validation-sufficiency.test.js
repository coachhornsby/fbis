import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Soccer Phase 3D preserves causal warm-up gates", async () => {
  const v3 = await readFile(new URL("../functions/lib/soccerFbisV3.js", import.meta.url), "utf8");
  assert.match(v3, /MIN_LEAGUE=80,MIN_TEAM=8/);
  assert.match(v3, /state\.model\.updates>=50/);
  assert.match(v3, /String\(x\.match_date\)<cutoff/);
  assert.match(v3, /persistentStateUsed:false/);
});

test("Soccer Phase 3D Stage B balances validation depth without reducing workers", async () => {
  const claim = await readFile(new URL("../functions/api/soccer-pitchapi-queue-claim.js", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/soccer-pitchapi-queue-drain.yml", import.meta.url), "utf8");

  assert.match(workflow, /max-parallel:\s*6/);
  assert.match(workflow, /worker:\s*\[1, 2, 3, 4, 5, 6\]/);

  assert.match(claim, /LEFT JOIN soccer_competition_coverage c ON c\.heritage_key=q\.heritage_key/);
  assert.match(claim, /COALESCE\(c\.advanced_rows,0\) ASC/);
  assert.match(claim, /NOT EXISTS \([\s\S]*active\.heritage_key=q\.heritage_key[\s\S]*active\.status='LEASED'/);
  assert.match(claim, /q\.season ASC/);
  assert.match(claim, /q\.offset ASC/);
  assert.match(claim, /VALIDATION_FLOOR=120/);
});

test("Soccer Phase 3D keeps all ten priority competitions ahead of long tail", async () => {
  const claim = await readFile(new URL("../functions/api/soccer-pitchapi-queue-claim.js", import.meta.url), "utf8");
  for (const league of ["eng.1","eng.2","ger.1","esp.1","ita.1","fra.1","uefa.champions","uefa.europa","usa.1","mex.1"]) {
    assert.match(claim, new RegExp(league.replaceAll(".","\\.")));
  }
  assert.match(claim, /THEN 0 ELSE 1 END/);
});
