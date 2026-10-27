import { readFileSync } from "node:fs";
import { sportLedgerEnv } from "../functions/lib/sportLedgerRouting.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  FBIS_SPORTS,
  SPORT_DATABASES,
  productSportDbHandle,
  isSportDbAuthoritative,
} from "../functions/lib/databaseTopology.js";

// Contract test of the real product routing function, not the shadow-copy resolver.
// No production DB is modified and no approval is issued.
const handle = (name) => ({ name, prepare() { return { bind() { return this; } }; } });

test("all 11 sports: deployed shadow prevents product reads and writes from reaching sport D1", () => {
  assert.equal(FBIS_SPORTS.length, 11);
  const primary = handle("PRIMARY");
  for (const sport of FBIS_SPORTS) {
    const sportDb = handle(sport);
    const mode = `SPORT_DB_MODE_${sport.toUpperCase()}`;
    const env = {
      DB: primary,
      [SPORT_DATABASES[sport].binding]: sportDb,
      [mode]: "shadow",
      ...(sport === "nhl" ? { NHL_SPORT_DB_MODE: "shadow" } : {}),
    };
    const routed = productSportDbHandle(env, sport);
    assert.equal(routed.db, primary, `${sport} product I/O must remain PRIMARY`);
    assert.equal(routed.binding, "DB", sport);
    assert.equal(routed.productIoUsesSportDb, false, sport);
    assert.equal(isSportDbAuthoritative(env, sport), false, sport);
    assert.equal(productSportDbHandle(env, sport, { mode: "sport" }).db, primary, sport);
    assert.equal(productSportDbHandle(env, sport, { mode: "sport" }).productIoUsesSportDb, false, sport);
    assert.notEqual(routed.db, sportDb, sport);
  }
});

test("all 11 sports: setting sport mode without approved receipt never authorizes product I/O", () => {
  const primary = handle("PRIMARY");
  for (const sport of FBIS_SPORTS) {
    const mode = `SPORT_DB_MODE_${sport.toUpperCase()}`;
    const receipt = `SPORT_CUTOVER_RECEIPT_${sport.toUpperCase()}`;
    const env = {
      DB: primary,
      [SPORT_DATABASES[sport].binding]: handle(sport),
      [mode]: "sport",
      ...(sport === "nhl" ? { NHL_SPORT_DB_MODE: "sport" } : {}),
    };
    const noReceipt = productSportDbHandle(env, sport);
    assert.equal(noReceipt.db, ["cbb", "tennis"].includes(sport) ? null : primary, sport);
    assert.equal(noReceipt.productIoUsesSportDb, false, sport);
    assert.match(noReceipt.reason, /RECEIPT/, sport);
    env[receipt] = `unapproved-${sport}`;
    const unapproved = productSportDbHandle(env, sport);
    assert.equal(unapproved.db, ["cbb", "tennis"].includes(sport) ? null : primary, sport);
    assert.equal(unapproved.productIoUsesSportDb, false, sport);
    assert.match(unapproved.reason, /APPROVAL_RECORD/, sport);
  }
});

test("missing bindings preserve legacy routing; activated CBB and Tennis fail closed", () => {
  const primary = handle("PRIMARY");
  for (const sport of FBIS_SPORTS) {
    const env = { DB: primary, [`SPORT_DB_MODE_${sport.toUpperCase()}`]: "sport" };
    const routed = productSportDbHandle(env, sport);
    assert.equal(routed.db, ["cbb", "tennis"].includes(sport) ? null : primary, sport);
    assert.equal(routed.productIoUsesSportDb, false, sport);
  }
});


test("NBA ledger storage fails closed without independent readiness and CORE approval", () => {
  const primary = handle("PRIMARY");
  const nba = handle("NBA_DB");
  const env = { DB: primary, NBA_DB: nba, SPORT_DB_MODE_NBA: "sport", SPORT_DB_STRICT_NBA: "1" };
  const missingReady = sportLedgerEnv(env, "nba");
  assert.equal(missingReady.DB, null);
  assert.equal(missingReady.__sportLedgerRoutingError, "SPORT_LEDGER_NOT_QUALIFIED");
  const readyNoReceipt = sportLedgerEnv({ ...env, SPORT_DB_LEDGER_READY_NBA: "1" }, "nba");
  assert.equal(readyNoReceipt.DB, null);
  assert.match(readyNoReceipt.__sportLedgerRoutingError, /RECEIPT/);
  const readyUnapproved = sportLedgerEnv({ ...env, SPORT_DB_LEDGER_READY_NBA: "1", SPORT_CUTOVER_RECEIPT_NBA: "not-approved" }, "nba");
  assert.equal(readyUnapproved.DB, null);
  assert.match(readyUnapproved.__sportLedgerRoutingError, /APPROVAL/);
  const approvedEnv = {
    ...env,
    SPORT_DB_LEDGER_READY_NBA: "1",
    SPORT_CUTOVER_RECEIPT_NBA: "nba-verified-receipt",
    __fbisCutoverApprovals: new Map([["nba:nba-verified-receipt", { sport: "nba", status: "APPROVED" }]]),
  };
  const authorized = sportLedgerEnv(approvedEnv, "nba");
  assert.equal(authorized.DB, nba);
  assert.equal(authorized.__sportLedgerBinding, "NBA_DB");
  const rollback = sportLedgerEnv({ ...approvedEnv, SPORT_DB_MODE_NBA: "shadow" }, "nba");
  assert.equal(rollback.DB, primary);
});


test("health operations recognize exactly the four CORE-approved authoritative sports",()=>{
 const script=readFileSync(new URL("../scripts/sport-sync-health-ops.mjs",import.meta.url),"utf8");
 const match=script.match(/^const authoritative = new Set\(\[([^\]]+)\]\);$/m);
 assert.ok(match,"authoritative sports health allowlist missing");
 const names=[...match[1].matchAll(/"([a-z]+)"/g)].map(x=>x[1]);
 assert.deepEqual(names,["nfl","cfb","nhl","nba"]);
});

test("Tennis activated mode requires a matching CORE approval and never falls back to PRIMARY", () => {
  const primary = handle("PRIMARY");
  const tennis = handle("TENNIS_DB");
  const core = handle("CORE_DB");
  const receipt = "tennis-cutover-approved";
  const base = { DB: primary, TENNIS_DB: tennis,
    SPORT_DB_MODE_TENNIS: "sport", SPORT_CUTOVER_RECEIPT_TENNIS: receipt };
  assert.equal(productSportDbHandle(base, "tennis").db, null);
  const approval = { sport: "tennis", receipt_id: receipt, status: "APPROVED" };
  const cached = { ...base, __fbisCutoverApprovals:
    new Map([[`tennis:${receipt}`, approval]]) };
  assert.equal(productSportDbHandle(cached, "tennis").db, null,
    "Missing CORE binding must reject a cached approval");
  const approved = { ...cached, CORE_DB: core };
  assert.equal(productSportDbHandle(approved, "tennis").db, tennis);
  assert.equal(productSportDbHandle(approved, "tennis").productIoUsesSportDb, true);
  const revoked = { ...approved, __fbisCutoverApprovals:
    new Map([[`tennis:${receipt}`, { ...approval, revoked_at: "2026-10-26T00:00:00Z" }]]) };
  assert.equal(productSportDbHandle(revoked, "tennis").db, null);
  const wrongReceipt = { ...approved, __fbisCutoverApprovals:
    new Map([[`tennis:${receipt}`, { ...approval, receipt_id: "wrong" }]]) };
  assert.equal(productSportDbHandle(wrongReceipt, "tennis").db, null);
  assert.equal(productSportDbHandle({ ...approved, TENNIS_DB: null }, "tennis").db, null);
  assert.equal(productSportDbHandle({ ...approved, SPORT_DB_MODE_TENNIS: "shadow" }, "tennis").db, primary);
});
