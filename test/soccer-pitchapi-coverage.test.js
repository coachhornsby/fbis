import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("PitchAPI sync refreshes competition QA counters from persisted rows", async () => {
  const store = await readFile(new URL("../functions/lib/soccerPitchApiStore.js", import.meta.url), "utf8");
  const sync = await readFile(new URL("../functions/api/soccer-pitchapi-sync.js", import.meta.url), "utf8");
  assert.match(store, /refreshPitchApiCompetitionCoverage/);
  assert.match(store, /pitch_match_count/);
  assert.match(store, /advanced_rows/);
  assert.match(store, /advanced_coverage/);
  assert.match(store, /history_start/);
  assert.match(store, /home_network_centralization IS NOT NULL/);
  assert.match(sync, /refreshPitchApiCompetitionCoverage/);
  assert.match(sync, /coverageRefresh/);
});
