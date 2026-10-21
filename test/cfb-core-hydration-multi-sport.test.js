import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/_middleware.js";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";

const PRIMARY = { prepare() {} };
const NFL_DB = { prepare() {} };
const CFB_DB = { prepare() {} };
function core(rows, failSport = null) {
  return { prepare(sql) {
    let sport = null;
    return {
      bind(value) { sport = value; return this; },
      async all() {
        if (failSport === sport) throw new Error("CORE approval read failed");
        if (sql.includes("expires_at")) throw new Error("legacy CORE schema");
        return { results: rows.filter(row => row.sport === sport && row.status === "APPROVED") };
      },
    };
  } };
}
function envFor(rows, failSport = null) {
  return {
    DB: PRIMARY, NFL_DB, CFB_DB, CORE_DB: core(rows, failSport),
    SPORT_DB_MODE_NFL: "sport", SPORT_DB_MODE_CFB: "sport",
    SPORT_DB_STRICT_NFL: "true", SPORT_DB_STRICT_CFB: "true",
    SPORT_CUTOVER_RECEIPT_NFL: "receipt-nfl",
    SPORT_CUTOVER_RECEIPT_CFB: "receipt-cfb",
  };
}
const APPROVED = [
  { sport: "nfl", receipt_id: "receipt-nfl", status: "APPROVED" },
  { sport: "cfb", receipt_id: "receipt-cfb", status: "APPROVED" },
];
async function route(env) {
  return onRequest({
    env, request: new Request("https://test.example/api/projections?sport=cfb"),
    next: async () => ({
      nfl: productSportDbHandle(env, "nfl"),
      cfb: productSportDbHandle(env, "cfb"),
    }),
  });
}
test("Pages middleware independently hydrates NFL and CFB CORE approvals", async () => {
  const result = await route(envFor(APPROVED));
  assert.equal(result.nfl.binding, "NFL_DB");
  assert.equal(result.cfb.binding, "CFB_DB");
  assert.equal(result.nfl.canAuthorizeWager, false);
  assert.equal(result.cfb.canAuthorizeWager, false);
});
test("missing CFB receipt does not grant CFB even when NFL is approved", async () => {
  const result = await route(envFor(APPROVED.slice(0, 1)));
  assert.equal(result.nfl.binding, "NFL_DB");
  assert.equal(result.cfb.db, null);
  assert.equal(result.cfb.binding, "UNAVAILABLE");
});
test("a CORE lookup failure clears all request grants to fail closed", async () => {
  const result = await route(envFor(APPROVED, "cfb"));
  assert.equal(result.nfl.db, null);
  assert.equal(result.cfb.db, null);
});
