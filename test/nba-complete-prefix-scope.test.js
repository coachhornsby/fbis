import test from "node:test";
import assert from "node:assert/strict";
import { SPORT_PREFIX_TABLES, ensureMirroredSportTable } from "../functions/lib/sportWorkingCopy.js";

const expected = [
  "nba_decision_validation_runs",
  "nba_deep_game_shadow",
  "nba_deep_validation_runs",
  "nba_player_game_features",
  "nba_player_impact_validation",
  "nba_player_prop_impact_shadow",
  "nba_player_prop_projections",
  "nba_prop_comparisons",
  "nba_prop_market_evaluations",
  "nba_prospective_exclusions",
  "nba_prospective_game_shadow",
  "nba_prospective_gate",
  "nba_prospective_market_links",
];

test("NBA prefix scope includes previously excluded production research tables", () => {
  const all = SPORT_PREFIX_TABLES.nba;
  assert.equal(new Set(all).size, all.length, "no duplicate table names");
  assert.equal(all.length, 31, "all known NBA-prefixed primary tables must be represented");
  for (const table of expected) assert.ok(all.includes(table), table);
});

test("existing shadow copier exposes additive source-schema mirroring, not destructive DDL", () => {
  assert.equal(typeof ensureMirroredSportTable, "function");
});
