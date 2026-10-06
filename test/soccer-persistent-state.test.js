import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("soccer Phase 3 persistent state remains research-only", async () => {
  const migration = await readFile(new URL("../migrations/0063_soccer_persistent_state_research.sql", import.meta.url), "utf8");
  const api = await readFile(new URL("../functions/api/soccer-profile-refresh.js", import.meta.url), "utf8");
  assert.match(migration, /soccer_team_state/);
  assert.match(migration, /soccer_player_state/);
  assert.match(migration, /soccer_availability_observations/);
  assert.match(migration, /soccer_team_state_snapshots/);
  assert.match(migration, /soccer_player_state_snapshots/);
  assert.match(migration, /research_only INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /can_influence_projection INTEGER NOT NULL DEFAULT 0/);
  assert.match(api, /canInfluenceProjection:false/);
  assert.match(api, /availability_status/);
  assert.match(api, /lineup_continuity_5/);
  assert.match(api, /rotation_index_5/);
  assert.match(api, /VENUE_COORDINATES_NOT_AVAILABLE/);
});
