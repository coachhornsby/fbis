import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSportDb,
  productSportDbHandle,
  isSportDbAuthoritative,
} from "../functions/lib/databaseTopology.js";

function db(tag) {
  return {
    tag,
    prepare() {
      return {
        async first() { return { n: 1 }; },
        bind() { return this; },
        async all() { return { results: [] }; },
        async run() { return { meta: { changes: 0 } }; },
      };
    },
  };
}

test("shadow mode product handle stays on PRIMARY even when sport DB is bound", () => {
  const primary = db("primary");
  const nhl = db("nhl");
  const env = { DB: primary, NHL_DB: nhl, NHL_SPORT_DB_MODE: "shadow" };
  const resolved = resolveSportDb(env, "nhl");
  assert.equal(resolved.mode, "shadow");
  assert.equal(resolved.db, primary);
  assert.equal(resolved.binding, "DB");
  assert.equal(resolved.preferred, false);
  assert.equal(resolved.productIoUsesSportDb, false);
  assert.equal(resolved.sportDb, nhl);

  const product = productSportDbHandle(env, "nhl");
  assert.equal(product.db, primary);
  assert.equal(product.binding, "DB");
  assert.equal(product.productIoUsesSportDb, false);
  assert.equal(isSportDbAuthoritative(env, "nhl"), false);
});

test("shadow mode cannot be overridden into product sport IO by reading sportDb field", () => {
  const primary = db("primary");
  const nfl = db("nfl");
  const env = { DB: primary, NFL_DB: nfl, SPORT_DB_MODE_NFL: "shadow" };
  const resolved = resolveSportDb(env, "nfl");
  // Telemetry may see sportDb, but product path must ignore it.
  assert.ok(resolved.sportDb);
  const product = productSportDbHandle(env, "nfl");
  assert.notEqual(product.db, nfl);
  assert.equal(product.db, primary);
  assert.equal(product.shadowSportDbBound, true);
});

test("sport mode is the only mode that returns sport DB for product IO", () => {
  const primary = db("primary");
  const cfb = db("cfb");
  const env = { DB: primary, CFB_DB: cfb, SPORT_DB_MODE_CFB: "sport" };
  const product = productSportDbHandle(env, "cfb");
  assert.equal(product.db, cfb);
  assert.equal(product.binding, "CFB_DB");
  assert.equal(product.productIoUsesSportDb, true);
  assert.equal(isSportDbAuthoritative(env, "cfb"), true);
});

test("cutover guard falls back to primary when sport handle is inconsistent", () => {
  const primary = db("primary");
  const fake = db("fake");
  // Env claims sport mode but binding points at a different object than plan binding value.
  const env = {
    DB: primary,
    CFB_DB: fake,
    SPORT_DB_MODE_CFB: "sport",
  };
  // Corrupt after resolve by swapping DB identity: productSportDbHandle compares env[plan.binding].
  // If CFB_DB is missing prepare path somehow, still falls back.
  const broken = {
    DB: primary,
    // plan binding CFB_DB intentionally absent while mode forced
    SPORT_DB_MODE_CFB: "sport",
  };
  const product = productSportDbHandle(broken, "cfb", { mode: "sport" });
  assert.equal(product.db, primary);
  assert.equal(product.productIoUsesSportDb, false);
  assert.match(product.reason, /UNBOUND|GUARD|NOT_PROVISIONED|PRIMARY/i);
});

test("all configured shadow sports keep product IO on primary", () => {
  const primary = db("primary");
  const env = {
    DB: primary,
    NHL_DB: db("nhl"),
    NFL_DB: db("nfl"),
    CFB_DB: db("cfb"),
    NHL_SPORT_DB_MODE: "shadow",
    SPORT_DB_MODE_NFL: "shadow",
    SPORT_DB_MODE_CFB: "shadow",
  };
  for (const sport of ["nhl", "nfl", "cfb"]) {
    assert.equal(productSportDbHandle(env, sport).db, primary, sport);
    assert.equal(isSportDbAuthoritative(env, sport), false, sport);
  }
});

test("caller mode=sport cannot bypass deployed shadow on productSportDbHandle", () => {
  const primary = db("primary");
  const nfl = db("nfl");
  const env = { DB: primary, NFL_DB: nfl, SPORT_DB_MODE_NFL: "shadow" };
  const product = productSportDbHandle(env, "nfl", { mode: "sport" });
  assert.equal(product.db, primary);
  assert.equal(product.productIoUsesSportDb, false);
  assert.equal(product.reason, "CALLER_MODE_OVERRIDE_REJECTED_ENV_AUTHORITY");
  assert.equal(isSportDbAuthoritative(env, "nfl", { mode: "sport" }), false);

  const resolved = resolveSportDb(env, "nfl", { mode: "sport" });
  assert.equal(resolved.mode, "shadow");
  assert.equal(resolved.productIoUsesSportDb, false);
  assert.equal(resolved.db, primary);
});
