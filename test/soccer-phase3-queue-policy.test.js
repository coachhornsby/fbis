import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("soccer Phase 3 queue uses breadth-to-120 then deep-fill policy", async () => {
  const claim=await readFile(new URL("../functions/api/soccer-pitchapi-queue-claim.js",import.meta.url),"utf8");
  const store=await readFile(new URL("../functions/lib/soccerPitchApiStore.js",import.meta.url),"utf8");

  for(const key of ["eng.1","eng.2","ger.1","esp.1","ita.1","fra.1","uefa.champions","uefa.europa","usa.1","mex.1"]){
    assert.match(claim,new RegExp(key.replace(".","\\.")));
  }
  assert.match(claim,/VALIDATION_FLOOR=120/);
  assert.match(claim,/underfilled=PRIORITY_KEYS\.filter\(k=>counts\[k\]<VALIDATION_FLOOR\)/);
  assert.match(claim,/ORDER BY eligible_advanced_count ASC/);
  assert.match(claim,/active\.status='LEASED'/);
  assert.match(claim,/active\.lease_until>=\?/);
  assert.match(claim,/excludeKeys:state\.stage==="A_BREADTH"\?state\.underfilled:\[\]/);
  assert.match(claim,/A_BREADTH_FALLBACK_DEPTH/);
  assert.match(claim,/B_DEPTH/);

  assert.match(store,/status='finished'/);
  assert.match(store,/home_score IS NOT NULL AND away_score IS NOT NULL/);
  assert.match(store,/home_xg IS NOT NULL AND away_xg IS NOT NULL/);
  assert.match(store,/home_ppda IS NOT NULL AND away_ppda IS NOT NULL/);
  assert.match(store,/home_field_tilt IS NOT NULL AND away_field_tilt IS NOT NULL/);
  assert.match(store,/home_network_centralization IS NOT NULL AND away_network_centralization IS NOT NULL/);

  assert.doesNotMatch(claim,/soccer_team_state|soccer_player_state|market|odds/i);
});

test("soccer Phase 3 worker envelope remains unchanged", async () => {
  const workflow=await readFile(new URL("../.github/workflows/soccer-pitchapi-queue-drain.yml",import.meta.url),"utf8");
  assert.match(workflow,/cron:\s*"\*\/5 \* \* \* \*"/);
  assert.match(workflow,/max-parallel:\s*6/);
  assert.match(workflow,/worker:\s*\[1, 2, 3, 4, 5, 6\]/);
  assert.match(workflow,/for iteration in 1 2 3; do/);
  assert.match(workflow,/--max-time 120/);
});
