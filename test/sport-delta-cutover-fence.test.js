import test from "node:test";
import assert from "node:assert/strict";
import { syncSportWorkingDelta, copySportWorkingTables, copySportPrefixTables } from "../functions/lib/sportWorkingCopy.js";

test("primary-to-sport NFL sync refuses deployed sport authority even without hydrated CORE receipt", async () => {
  const output = await syncSportWorkingDelta({
    SPORT_DB_MODE_NFL: "sport",
    DB: { prepare() { throw Error("MUST_NOT_READ_PRIMARY"); } },
    NFL_DB: { prepare() { throw Error("MUST_NOT_WRITE_SPORT"); } },
  }, "nfl");
  assert.equal(output.ok, false);
  assert.equal(output.reason, "SHADOW_SYNC_REFUSED_SPORT_MODE");
  assert.equal(output.canAuthorizeWager, false);
});

test("direct copy surfaces refuse deployed sport mode before touching either DB", async () => {
 const env={SPORT_DB_MODE_NFL:"sport",DB:{prepare(){throw Error("primary access")}},
  NFL_DB:{prepare(){throw Error("sport access")}}};
 for(const call of [copySportWorkingTables,copySportPrefixTables]){
  const result=await call(env,"nfl");
  assert.equal(result.ok,false);
  assert.equal(result.reason,"SHADOW_SYNC_REFUSED_SPORT_MODE");
 }
});
