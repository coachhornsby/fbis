import test from "node:test";
import assert from "node:assert/strict";

import { parseCfbDeepPpaRow, attachCfbDeepFeatures } from "../functions/lib/cfbDeepFeed.js";
import { parseCsv, aggregateTeamWeeks, aggregateQbWeeks, attachNflVerseFeatures } from "../functions/lib/nflVerseFeed.js";
import { parseBullpenStat, attachMlbBullpenContext } from "../functions/lib/mlbBullpenFeed.js";

test("CFBD deep parser preserves pass/rush offense and defense dimensions", () => {
  const row = parseCfbDeepPpaRow({
    team: "Texas",
    offense: { passing: 0.31, rushing: 0.14, successRate: 0.49, explosiveness: 0.16 },
    defense: { passing: 0.02, rushing: -0.04, successRate: 0.39, explosiveness: 0.09 },
  });
  assert.equal(row.passEpa, 0.31);
  assert.equal(row.rushEpa, 0.14);
  assert.equal(row.passEpaAllowed, 0.02);
  assert.equal(row.rushEpaAllowed, -0.04);
  assert.equal(row.successRate, 0.49);
  assert.equal(row.explosiveRateAllowed, 0.09);
});

test("CFB deep feed attaches team-specific features without touching projection", () => {
  const games = [{ sport: "cfb", projHomeScore: 31, projAwayScore: 24, home: { espnId: "1", school: "Home" }, away: { espnId: "2", school: "Away" } }];
  const out = attachCfbDeepFeatures(games, { byEspnId: { "1": { passEpa: 0.2 }, "2": { passEpaAllowed: 0.1 } }, bySchool: {} });
  assert.equal(out[0].projHomeScore, 31);
  assert.equal(out[0].cfbDeepInput.home.passEpa, 0.2);
  assert.equal(out[0].cfbDeepInput.away.passEpaAllowed, 0.1);
});

test("nflverse CSV parser and team aggregator build offense and opponent-inverted defense", () => {
  const csv = [
    "season,week,team,season_type,opponent_team,attempts,sacks_suffered,passing_epa,carries,rushing_epa,def_qb_hits,def_sacks",
    "2025,1,BUF,REG,BAL,40,2,8.4,25,2.5,6,3",
    "2025,1,BAL,REG,BUF,30,3,3.3,30,6.0,4,2",
  ].join("\n");
  const rows = parseCsv(csv);
  const agg = aggregateTeamWeeks(rows);
  assert.equal(rows.length, 2);
  assert.ok(agg.offense.BUF.passEpa > 0);
  assert.ok(agg.defense.BUF.passEpaAllowed > 0);
  assert.equal(agg.offense.BUF.games, 1);
  assert.equal(agg.defense.BUF.games, 1);
});

test("nflverse QB aggregator calculates EPA per dropback and weighted CPOE", () => {
  const rows = [
    { season_type: "REG", team: "BUF", week: "1", attempts: "30", sacks_suffered: "2", passing_epa: "6.4", passing_cpoe: "4" },
    { season_type: "REG", team: "BUF", week: "2", attempts: "20", sacks_suffered: "1", passing_epa: "2.1", passing_cpoe: "2" },
  ];
  const qb = aggregateQbWeeks(rows).BUF;
  assert.equal(qb.games, 2);
  assert.ok(qb.qbEpa > 0);
  assert.ok(qb.qbCpoe > 2 && qb.qbCpoe < 4);
  assert.ok(qb.qbSackRate > 0);
});

test("nflverse features attach to NFL shadow input only", () => {
  const game = { sport: "nfl", home: { abbr: "BUF" }, away: { abbr: "BAL" }, projectionKind: "PINNACLE_IMPLIED" };
  const out = attachNflVerseFeatures([game], { byTeam: { BUF: { offenseEpa: 0.12, qbEpa: 0.16 }, BAL: { defenseEpa: -0.04, qbEpa: 0.09 } } });
  assert.equal(out[0].projectionKind, "PINNACLE_IMPLIED");
  assert.equal(out[0].nflFeatures.home.offenseEpa, 0.12);
  assert.equal(out[0].nflFeatures.away.defenseEpa, -0.04);
});

test("MLB relief split parser and attachment feed bullpen ERA to shadow context only", () => {
  const parsed = parseBullpenStat({ stats: [{ splits: [{ stat: { era: "3.62", whip: "1.21", inningsPitched: "410.2" } }] }] });
  assert.equal(parsed.era, 3.62);
  assert.equal(parsed.whip, 1.21);
  const game = { sport: "mlb", home: { mlbId: 119 }, away: { mlbId: 137 }, projHomeScore: 4.7, projAwayScore: 4.1 };
  const out = attachMlbBullpenContext([game], { byTeamId: { "119": { era: 3.62, asOf: "x" }, "137": { era: 4.18, asOf: "x" } } });
  assert.equal(out[0].projHomeScore, 4.7);
  assert.equal(out[0].mlbContext.homeBullpenEra, 3.62);
  assert.equal(out[0].mlbContext.awayBullpenEra, 4.18);
});
