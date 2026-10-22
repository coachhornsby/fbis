import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ddl=readFileSync(new URL("../sql/shards/nhl-sport-v1.sql",import.meta.url),"utf8");
test("NHL source uniqueness survives sports DB bootstrap",()=>{
 const specs={
  ux_nhl_goalie_shadow_event_model:["nhl_goalie_probability_shadow","event_id,model_version"],
  ux_nhl_linemates_team_pair_strength:["nhl_linemate_profiles","team_key,player_id,teammate_id,strength_state"],
  ux_nhl_schedule_season_team_game:["nhl_team_schedule_profile","season_id,team_key,game_id"]
 };
 for(const [name,[table,keys]] of Object.entries(specs)){
   assert.ok(ddl.includes("CREATE UNIQUE INDEX IF NOT EXISTS "+name),name);
   assert.ok(ddl.includes("ON "+table+"("+keys+")"),table+" keys");
 }
});
