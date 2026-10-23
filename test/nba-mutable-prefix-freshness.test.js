import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newerPrefixSourceTimestamp } from "../functions/lib/sportWorkingCopy.js";

const code = readFileSync(new URL("../functions/lib/sportWorkingCopy.js", import.meta.url), "utf8");

test("NBA mutable prefix tables participate in same-count freshness replays", () => {
  const required = [
    'nba_observation_health: "updated_at"',
    'nba_player_state_profiles: "updated_at"',
    'nba_team_profiles: "updated_at"',
    'nba_team_schedule_items: ["observed_at", "created_at"]',
    'nba_wager_decisions: ["graded_at", "created_at"]',
    'nba_player_prop_projections: ["graded_at", "created_at"]',
    'nba_player_prop_impact_shadow: ["graded_at", "created_at"]',
    'nba_prospective_game_shadow: ["graded_at", "created_at"]',
    'nba_deep_game_shadow: ["created_at", "graded_at"]',
  ];
  for (const entry of required) assert.ok(code.includes(entry), entry);
  assert.match(code, /for \(const field of \[freshnessColumns\]\.flat\(\)\)/);
});

test("newer NBA profile and observation timestamps require replay", () => {
  assert.equal(newerPrefixSourceTimestamp("2026-10-23T05:14:15.128Z","2026-10-20T20:03:50.968Z"),true);
  assert.equal(newerPrefixSourceTimestamp("2026-10-23T00:45:32.224Z","2026-10-20T15:41:53.514Z"),true);
  assert.equal(newerPrefixSourceTimestamp("2026-10-23T00:45:32.224Z","2026-10-23T00:45:32.224Z"),false);
});
