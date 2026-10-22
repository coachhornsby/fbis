import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=readFileSync(new URL("../functions/lib/nhlPersistentProfiles.js",import.meta.url),"utf8");
test("NHL profile sync starts with explicit numeric counters, not PRIMARY-only defaults",()=>{
 const start=source.indexOf("INSERT INTO nhl_profile_sync_runs(");
 const end=source.indexOf(".run();",start);
 assert.ok(start>0&&end>start,"initial sync run write not found");
 const sql=source.slice(start,end);
 for(const key of ["source_calls","roster_rows","schedule_rows","player_rows_upserted",
  "goalie_rows_upserted","linemate_rows_upserted","deployment_rows_upserted"]){
   assert.match(sql,new RegExp("\\b"+key+"\\b"));
 }
 assert.match(sql,/VALUES\(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?\)/);
 assert.match(sql,/\.bind\(runId,seasonId,tkey,"RUNNING",NHL_PERSISTENT_PROFILE_SOURCE,started,0,0,0,0,0,0,0\)/);
});
