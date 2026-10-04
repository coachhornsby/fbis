import test from "node:test";
import assert from "node:assert/strict";

import { latestByCandidate, groupKey } from "../functions/api/selective-props.js";

test("PrizePicks dedupe preserves Standard Goblin and Demon variants", () => {
  const base = {
    sport: "nfl",
    player_name: "Player A",
    canonical_market: "receiving_yards",
    duration: "full",
  };
  const rows = latestByCandidate([
    { ...base, odds_tier: "standard", line: 55.5, collected_at: "2026-10-04T08:00:00Z" },
    { ...base, odds_tier: "goblin", line: 45.5, collected_at: "2026-10-04T08:00:00Z" },
    { ...base, odds_tier: "demon", line: 65.5, collected_at: "2026-10-04T08:00:00Z" },
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.odds_tier).sort(), ["demon","goblin","standard"]);
});

test("Top-25 grouping ignores tier so one player/market occupies one card", () => {
  const base = {
    sport: "mlb",
    player_name: "Player B",
    canonical_market: "strikeouts",
    duration: "full",
  };
  assert.equal(
    groupKey({ ...base, odds_tier: "standard", line: 5.5 }),
    groupKey({ ...base, odds_tier: "goblin", line: 4.5 }),
  );
  assert.equal(
    groupKey({ ...base, odds_tier: "standard", line: 5.5 }),
    groupKey({ ...base, odds_tier: "demon", line: 6.5 }),
  );
});
