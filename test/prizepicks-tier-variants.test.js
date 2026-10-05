import test from "node:test";
import assert from "node:assert/strict";

import { latestByCandidate, groupKey, strongestByGroup } from "../functions/api/selective-props.js";

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


test("Top-25 group representative cannot be an unpriced Demon/Goblin variant", () => {
  const base = {
    sport:"nfl",player_name:"QB A",canonical_market:"completions",duration:"full",
  };
  const standard = {
    ...base,odds_tier:"standard",confidenceStars:5,selectionScore:520,
    prizePicksEconomics:{rankingEligible:true}
  };
  const demon = {
    ...base,odds_tier:"demon",confidenceStars:2,selectionScore:9999,
    prizePicksEconomics:{rankingEligible:false}
  };
  const strongest = strongestByGroup([demon,standard]);
  assert.equal(strongest.get(groupKey(base)).odds_tier,"standard");
});

test("unpriced alternate-only group cannot enter Top-25 ranking", () => {
  const demon = {
    sport:"nfl",player_name:"QB A",canonical_market:"completions",duration:"full",
    odds_tier:"demon",confidenceStars:2,selectionScore:9999,
    prizePicksEconomics:{rankingEligible:false}
  };
  assert.equal(strongestByGroup([demon]).size,0);
});
