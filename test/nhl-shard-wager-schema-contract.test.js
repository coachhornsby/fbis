import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const shard=readFileSync(new URL("../sql/shards/nhl-sport-v1.sql",import.meta.url),"utf8");
const canonical=readFileSync(new URL("../migrations/0042_nhl_wager_research.sql",import.meta.url),"utf8");
function block(sql,table){const re=new RegExp("CREATE TABLE IF NOT EXISTS "+table+" \\(([\\s\\S]*?)\\);");const match=sql.match(re);assert.ok(match,table+" DDL missing");return match[1];}
test("NHL shard wager decisions use the actual 35-column production model",()=>{
 const schema=block(shard,"nhl_wager_decisions");
 for(const column of ["id","snapshot_at","event_id","wager_scope","american_price","calibrated_probability",
  "market_no_vig_probability","confidence","research_candidate","can_authorize_wager","created_at","game_type"]){
  assert.match(schema,new RegExp("\\b"+column+"\\s+"));
 }
 assert.doesNotMatch(schema,/decision_id TEXT PRIMARY KEY/);
 assert.doesNotMatch(schema,/payload_json TEXT/);
 assert.equal([...schema.matchAll(/^\s+[a-z_]+\s+(?:TEXT|REAL|INTEGER)\b/gm)].length,35);
 assert.match(shard,/idx_nhl_wager_decisions_game_type/);
});
test("NHL settlement stores canonical foreign key, evidence and settlement results",()=>{
 const schema=block(shard,"nhl_wager_settlements");
 for(const column of ["decision_id","event_id","settled_at","actual_home","actual_away","actual_player_value",
  "result","risk_units","profit_units","close_line","close_price","close_no_vig_probability",
  "clv_probability_pp","notes"]){
  assert.match(schema,new RegExp("\\b"+column+"\\s+"));
 }
 assert.match(schema,/FOREIGN KEY\(decision_id\) REFERENCES nhl_wager_decisions\(id\)/);
 assert.equal([...schema.matchAll(/^\s+[a-z_]+\s+(?:TEXT|REAL|INTEGER)\b/gm)].length,14);
 assert.doesNotMatch(schema,/settlement_id TEXT PRIMARY KEY/);
});
test("Calibration view and production wager evidence indexes exist",()=>{
 assert.match(shard,/CREATE VIEW IF NOT EXISTS nhl_wager_confidence_calibration AS/);
 assert.match(shard,/JOIN nhl_wager_settlements s ON s.decision_id=d.id/);
 for(const name of ["idx_nhl_wager_decisions_event","idx_nhl_wager_decisions_market",
 "idx_nhl_wager_decisions_research_bet","idx_nhl_wager_decisions_game_type",
 "idx_nhl_wager_settlements_event"]){
  assert.ok(shard.includes(name),"missing "+name);
 }
 assert.ok(canonical.includes("nhl_wager_confidence_calibration"));
});
