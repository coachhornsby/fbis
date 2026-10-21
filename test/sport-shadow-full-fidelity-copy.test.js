import test from "node:test";
import assert from "node:assert/strict";
import { fullFidelitySportUpsertSql } from "../functions/lib/sportWorkingCopy.js";

test("sport game shadow copy preserves all source fields including date", () => {
  const sql=fullFidelitySportUpsertSql("games",
    ["id","sport","date","start","status","home_name","updated_at"], {
      preserveNullable:["status"],
    });
  assert.match(sql,/date=excluded.date/);
  assert.match(sql,/status=COALESCE\(excluded.status,games.status\)/);
  assert.match(sql,/updated_at=excluded.updated_at/);
  assert.ok(sql.includes("ON CONFLICT(id)"));
});
test("sport snapshot shadow copy carries checkpoint, grading and model state",()=>{
  const sql=fullFidelitySportUpsertSql("prediction_snapshots",[
    "id","sport","date","matchup","checkpoint","engine","projection_state",
    "pal_json","lineups_official","p_score","p_form","data_quality",
    "model_version","payload_json","graded_at",
  ]);
  for(const field of ["date","matchup","checkpoint","engine","projection_state",
    "pal_json","lineups_official","p_score","p_form","data_quality","graded_at"]) {
    assert.ok(sql.includes(field+"=excluded."+field),field);
  }
  assert.ok(!sql.includes("game_date=excluded.game_date"));
});
test("unsafe names and missing immutable identifiers fail closed",()=>{
  assert.throws(()=>fullFidelitySportUpsertSql("games;DROP",["id","sport"]),/UNSAFE_IDENT/);
  assert.throws(()=>fullFidelitySportUpsertSql("games",["sport"]),/FULL_FIDELITY_ID_REQUIRED/);
  assert.throws(()=>fullFidelitySportUpsertSql("games",["id","unsafe-column"]),/UNSAFE_IDENT/);
});
