import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPORT_PREFIX_TABLES } from "../functions/lib/sportWorkingCopy.js";
const ddl=readFileSync(new URL("../sql/shards/nhl-v2-replacement-and-tracking.sql",import.meta.url),"utf8");

test("NHL shadow scope includes tracking and replacement evidence tables",()=>{
 for(const table of ["nhl_player_tracking_profiles","nhl_replacement_observations"]) {
  assert.equal(SPORT_PREFIX_TABLES.nhl.filter(name=>name===table).length,1,table);
  assert.match(ddl,new RegExp("CREATE TABLE IF NOT EXISTS "+table+" \\("));
 }
});
test("NHL migration DDL is additive and preserves independent research evidence",()=>{
 assert.doesNotMatch(ddl,/\b(?:DROP TABLE|DELETE FROM|TRUNCATE|REPLACE INTO)\b/i);
 assert.match(ddl,/UNIQUE\(game_id,unavailable_player_id,replacement_player_id\)/);
 assert.match(ddl,/source_as_of TEXT NOT NULL/);
 assert.match(ddl,/observed_at TEXT NOT NULL/);
});
