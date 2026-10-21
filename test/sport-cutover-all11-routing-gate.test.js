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
    assert.equal(noReceipt.db, primary, sport);
    assert.equal(noReceipt.productIoUsesSportDb, false, sport);
    assert.match(noReceipt.reason, /RECEIPT/, sport);
    env[receipt] = `unapproved-${sport}`;
    const unapproved = productSportDbHandle(env, sport);
    assert.equal(unapproved.db, primary, sport);
    assert.equal(unapproved.productIoUsesSportDb, false, sport);
    assert.match(unapproved.reason, /APPROVAL_RECORD/, sport);
  }
});

test("all 11 sports: missing sport bindings fail back to PRIMARY", () => {
  const primary = handle("PRIMARY");
  for (const sport of FBIS_SPORTS) {
    const env = { DB: primary, [`SPORT_DB_MODE_${sport.toUpperCase()}`]: "sport" };
    const routed = productSportDbHandle(env, sport);
    assert.equal(routed.db, primary, sport);
    assert.equal(routed.productIoUsesSportDb, false, sport);
  }
});
