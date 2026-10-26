import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rehearseSportCutover } from "../functions/lib/sportCutoverRehearsal.js";

function inertD1() {
  const chain = {
    bind() { return this; },
    async all() { return { results: [] }; },
    async first() { return null; },
  };
  return { prepare() { return chain; } };
}

test("CBB cutover rehearsal never passes on empty source/destination game and prediction boards", async () => {
  const primary = inertD1();
  const cbb = inertD1();
  const env = {
    DB: primary,
    CBB_DB: cbb,
    CORE_DB: inertD1(),
    SPORT_DB_MODE_CBB: "shadow",
    SPORT_DB_STRICT_CBB: "true",
    SPORT_DB_LEDGER_READY_CBB: "true",
  };
  const result = await rehearseSportCutover(env, "cbb", { sampleSize: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.liveCutoverAuthorized, false);
  assert.equal(result.canAuthorizeWager, false);
  assert.equal(result.productionCutoverBlocked, true);
  const populated = result.steps.find(step => step.step === "cbb_populated_live_board_required");
  assert.ok(populated, "CBB live-board gate must be visible in the receipt");
  assert.equal(populated.ok, false);
  assert.equal(populated.primaryGameCount, 0);
  assert.equal(populated.primaryProjectionCount, 0);
  assert.equal(populated.candidateGameCount, 0);
  assert.equal(populated.candidateProjectionCount, 0);
  assert.equal(env.SPORT_DB_MODE_CBB, "shadow");
  assert.equal(env.SPORT_CUTOVER_RECEIPT_CBB, undefined);
  assert.equal(result.deployedStillAuthoritative, true);
});

test("CBB missing-binding/partial/CORE-staleness drills cannot activate authority", async () => {
  const env = {
    DB: inertD1(),
    CBB_DB: inertD1(),
    CORE_DB: inertD1(),
    SPORT_DB_MODE_CBB: "shadow",
    SPORT_DB_STRICT_CBB: "true",
    SPORT_DB_LEDGER_READY_CBB: "true",
  };
  for (const scenario of [
    { injectMissingBinding: true },
    { injectPartialSport: true },
    { injectStaleCore: true },
  ]) {
    const result = await rehearseSportCutover(env, "cbb", scenario);
    assert.equal(result.ok, false);
    assert.equal(result.canAuthorizeWager, false);
    assert.equal(result.liveCutoverAuthorized, false);
    assert.equal(result.steps.find(x => x.step === "cbb_populated_live_board_required")?.ok, false);
    assert.equal(env.SPORT_DB_MODE_CBB, "shadow");
    assert.equal(env.SPORT_CUTOVER_RECEIPT_CBB, undefined);
  }
});

test("CBB is explicitly allowed by guarded rehearsal and migration qualification routes", () => {
  const api = readFileSync(new URL("../functions/api/database-topology.js", import.meta.url), "utf8");
  const qualify = readFileSync(new URL("../functions/lib/sportMigrationQualify.js", import.meta.url), "utf8");
  assert.match(api, /\["nhl", "nfl", "cfb", "cbb"\]\.includes\(sport\)/);
  assert.match(qualify, /\["nfl", "cfb", "nhl", "nba", "cbb"\]\.includes\(key\)/);
});
