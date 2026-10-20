import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { selectTopPrizePicksCards, prizePicksWinChance } from "../src/features/today/selectTopPrizePicksCards.js";

test("top board PrizePicks cards keep Standard only and rank by win chance", () => {
  const rows = [
    { sport: "nfl", player_name: "A", canonical_market: "passing_yards", line: 250, fbis_projection: 280, fbis_sigma: 30, odds_tier: "standard", candidate_side: "MORE" },
    { sport: "nfl", player_name: "A", canonical_market: "passing_yards", line: 320, fbis_projection: 280, fbis_sigma: 30, odds_tier: "demon", candidate_side: "LESS" },
    { sport: "nfl", player_name: "B", canonical_market: "receiving_yards", line: 60, fbis_projection: 90, fbis_sigma: 20, odds_tier: "standard", candidate_side: "MORE" },
    { sport: "nfl", player_name: "C", canonical_market: "rushing_yards", line: 50, fbis_projection: 40, fbis_sigma: 15, odds_tier: "goblin", candidate_side: "LESS" },
    { sport: "mlb", player_name: "D", canonical_market: "strikeouts", line: 5.5, fbis_projection: 7.2, fbis_sigma: 1.8, odds_tier: "standard", candidate_side: "MORE" },
    { sport: "nfl", player_name: "E", canonical_market: "receptions", line: 4.5, fbis_projection: 6.1, fbis_sigma: 1.5, odds_tier: "standard", candidate_side: "MORE" },
    { sport: "nfl", player_name: "F", canonical_market: "rushing_yards", line: 55, fbis_projection: 70, fbis_sigma: 18, odds_tier: "standard", candidate_side: "MORE" },
    { sport: "nfl", player_name: "G", canonical_market: "passing_attempts", line: 34, fbis_projection: 36, fbis_sigma: 5, odds_tier: "standard", candidate_side: "MORE" },
  ];
  const nfl = selectTopPrizePicksCards(rows, { limit: 5, sportFilter: "nfl" });
  assert.equal(nfl.length, 5);
  assert.ok(nfl.every((r) => String(r.odds_tier).toLowerCase() === "standard"));
  assert.ok(nfl.every((r) => String(r.sport).toLowerCase() === "nfl"));
  assert.ok(!nfl.some((r) => r.player_name === "C"));
  for (let i = 1; i < nfl.length; i++) {
    assert.ok((nfl[i - 1]._winChance ?? 0) >= (nfl[i]._winChance ?? 0));
  }

  const all = selectTopPrizePicksCards(rows, { limit: 5, sportFilter: "all" });
  assert.equal(all.length, 5);
  assert.ok(all.some((r) => r.sport === "mlb"), "ALL should include the strongest MLB Standard line when competitive");
});

test("win chance is null without projection/line/sigma", () => {
  assert.equal(prizePicksWinChance({ fbis_projection: 10, line: 8 }), null);
  assert.ok(prizePicksWinChance({ fbis_projection: 10, line: 8, fbis_sigma: 2, candidate_side: "MORE" }) > 0.5);
});

test("Board TopPlayerProps renders PrizePicks cards not a props table", () => {
  const src = fs.readFileSync("src/features/today/TopPlayerProps.jsx", "utf8");
  assert.match(src, /ExchangePlayerPropCard/);
  assert.match(src, /exchange-player-props/);
  assert.doesNotMatch(src, /Demon\/Goblin/);
  assert.match(src, /pp-card-grid pp-premium-grid/);
  assert.doesNotMatch(src, /fbis-table today-compact-table/);
  assert.doesNotMatch(src, /\bcompact\b/);
});

test("Board command center drops watchlist beside Top PrizePicks", () => {
  const src = fs.readFileSync("src/features/today/TodayCommandCenter.jsx", "utf8");
  assert.match(src, /TopPlayerProps/);
  assert.doesNotMatch(src, /WatchlistPanel/);
});
