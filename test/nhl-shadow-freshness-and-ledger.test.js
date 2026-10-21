import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newerPrefixSourceTimestamp } from "../functions/lib/sportWorkingCopy.js";
const source=readFileSync(new URL("../functions/lib/sportWorkingCopy.js", import.meta.url),"utf8");
const sql=readFileSync(new URL("../sql/shards/nhl-v1-ledger-compat.sql",import.meta.url),"utf8");

test("NHL shadow ledger DDL is additive and has all four compatibility tables",()=>{
 for(const table of ["predictions","odds_snapshots","team_form","team_form_games"]){
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS "+table+" ("),table);
 }
 assert.match(sql,/idx_nhl_predictions_sport_date/);
 assert.match(sql,/idx_nhl_odds_sport_date/);
 assert.doesNotMatch(sql,/\bDELETE FROM\b|\bDROP TABLE\b/i);
});
test("NHL equal-count stale working rows trigger bounded replay",()=>{
 assert.match(source,/sport === "nhl" && table === "prediction_snapshots"/);
 assert.match(source,/sport === "nhl" && table === "games"/);
 assert.match(source,/plan\.staleContentReplay = true/);
 assert.equal(newerPrefixSourceTimestamp("2026-10-21T22:29:18Z","2026-10-20T15:43:13Z"),true);
 assert.equal(newerPrefixSourceTimestamp("2026-10-20T15:43:13Z","2026-10-21T22:29:18Z"),false);
});
test("NHL profile freshness watches updated goalies, schedules, and deployments",()=>{
 for (const token of [
  'nhl_team_profiles: "updated_at"',
  'nhl_goalie_profiles: "updated_at"',
  'nhl_team_schedule_profile: "source_updated_at"',
  'nhl_deployment_observations: "observed_at"',
  'cfb_pregame_feature_vectors: "created_at"',
 ]) assert.ok(source.includes(token),token);
});
