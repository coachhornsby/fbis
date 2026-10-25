import test from "node:test";
import assert from "node:assert/strict";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";

// No production CORE writes: every scenario uses in-memory approvals and inert D1 stubs.
const cases = {
  nfl: "nfl-20261021-production-v1",
  cfb: "cfb-20261021-production-v1",
  nba: "nba-20261023-production-v1",
  nhl: "nhl-20261022-production-v1",
};
const stub = () => ({ prepare() { return { first: async () => ({ok:1}) }; } });
for (const [sport, receipt] of Object.entries(cases)) {
  test(`Phase A ${sport}: approved sport route, revoked/expired/missing receipt fail closed`, () => {
    const primary = stub();
    const shard = stub();
    const key = sport.toUpperCase();
    const approvals = new Map([[sport + ":" + receipt, {
      sport, receipt_id: receipt, status: "APPROVED", approved_at: "2026-10-25T00:00:00Z"
    }]]);
    const env = {
      DB: primary,
      [key + "_DB"]: shard,
      ["SPORT_DB_MODE_" + key]: "sport",
      ["SPORT_DB_STRICT_" + key]: "true",
      ["SPORT_DB_LEDGER_READY_" + key]: "true",
      ["SPORT_CUTOVER_RECEIPT_" + key]: receipt,
      __fbisCutoverApprovals: approvals,
    };
    const approved = productSportDbHandle(env, sport);
    assert.equal(approved.binding, key + "_DB");
    assert.equal(approved.db, shard);
    assert.equal(approved.productIoUsesSportDb, true);
    assert.notEqual(approved.db, primary);
    approvals.set(sport + ":" + receipt, {status: "REVOKED"});
    const revoked = productSportDbHandle(env, sport);
    assert.equal(revoked.db, null);
    assert.equal(revoked.productIoUsesSportDb, false);
    approvals.set(sport + ":" + receipt, {status: "EXPIRED"});
    assert.equal(productSportDbHandle(env, sport).db, null);
    approvals.clear();
    assert.equal(productSportDbHandle(env, sport).db, null);
    env["SPORT_CUTOVER_RECEIPT_" + key] = "";
    assert.equal(productSportDbHandle(env, sport).db, null);
    env["SPORT_CUTOVER_RECEIPT_" + key] = receipt;
    env[key + "_DB"] = undefined;
    assert.equal(productSportDbHandle(env, sport).db, null);
  });
}
