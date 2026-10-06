import test from "node:test";
import assert from "node:assert/strict";

import { latestByCandidate, groupKey, strongestByGroup } from "../functions/api/selective-props.js";
import { prizePicksTierEconomics, selectivePropStars } from "../functions/lib/selectivePropEdge.js";

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


test("unpriced Demon/Goblin confidence cap applies across PrizePicks sports, not just NFL", () => {
  for (const sport of ["mlb","nba","wnba","nhl","cfb","cbb","soccer","tennis"]) {
    const row={
      sport,
      fbisProjection:100,
      line:50,
      fbisSigma:10,
      odds_tier:"demon",
      propGate:"CLEAR",
      eligibleForCard:true,
      dataQuality:.95,
    };
    assert.ok(selectivePropStars(row)<=2, sport);
    const economics=prizePicksTierEconomics(row,.90);
    assert.equal(economics.status,"ALTERNATE_TIER_PAYOUT_UNPRICED",sport);
    assert.equal(economics.rankingEligible,false,sport);
  }
});

test("standard PrizePicks tiers remain eligible across sports", () => {
  for (const sport of ["mlb","nba","wnba","nhl","cfb","cbb","soccer","tennis"]) {
    const economics=prizePicksTierEconomics({sport,odds_tier:"standard"},.60);
    assert.equal(economics.comparableToStandard,true,sport);
    assert.equal(economics.rankingEligible,true,sport);
    assert.equal(economics.maxStars,5,sport);
  }
});
