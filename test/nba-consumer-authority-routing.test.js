import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sportDbContext } from "../functions/lib/nflSportDbContext.js";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";

const current = readFileSync(new URL("../functions/api/collect-current.js", import.meta.url), "utf8");
const slate = readFileSync(new URL("../functions/lib/slateEngine.js", import.meta.url), "utf8");
const handle = (name) => ({ name, prepare() { return { bind() { return this; } }; } });

test("scheduled current collector preserves real sport database bindings and CORE receipt context", () => {
  assert.match(current, /\.\.\.sportDbContext\(context\.env\)/);
  const primary = handle("PRIMARY");
  const nba = handle("NBA");
  const context = sportDbContext({
    DB: primary, NBA_DB: nba, SPORT_DB_MODE_NBA: "shadow",
    SPORT_DB_STRICT_NBA: "1", SPORT_DB_LEDGER_READY_NBA: "1",
    SPORT_CUTOVER_RECEIPT_NBA: "test-receipt",
  });
  assert.equal(context.NBA_DB, nba);
  assert.equal(context.SPORT_DB_MODE_NBA, "shadow");
  assert.equal(context.SPORT_DB_LEDGER_READY_NBA, "1");
  assert.equal(context.SPORT_CUTOVER_RECEIPT_NBA, "test-receipt");
  assert.equal(productSportDbHandle({ DB: primary, ...context }, "nba").db, primary);
});

test("NBA slate uses approved sport authority, never unconditionally reads PRIMARY after cutover", () => {
  assert.match(slate, /const db = productSportDbHandle\(env, "nba"\)\.db \|\| null/);
  const primary = handle("PRIMARY");
  const nba = handle("NBA");
  const base = { DB: primary, NBA_DB: nba, SPORT_DB_MODE_NBA: "sport", SPORT_DB_STRICT_NBA: "1" };
  const noGrant = productSportDbHandle(base, "nba");
  assert.equal(noGrant.db, null);
  assert.equal(noGrant.productIoUsesSportDb, false);
  const approved = {
    ...base,
    SPORT_CUTOVER_RECEIPT_NBA: "test-grant",
    __fbisCutoverApprovals: new Map([["nba:test-grant", { sport: "nba", status: "APPROVED" }]]),
  };
  assert.equal(productSportDbHandle(approved, "nba").db, nba);
  assert.equal(productSportDbHandle({ ...approved, SPORT_DB_MODE_NBA: "shadow" }, "nba").db, primary);
});
