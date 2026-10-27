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
  assert.match(api, /\["nhl", "nfl", "cfb", "cbb", "tennis"\]\.includes\(sport\)/);
  assert.match(qualify, /runCutoverRehearsal && \[[^\]]*"cbb"[^\]]*\]\.includes\(key\)/);
});

function populatedD1({ projectedHome = 72 } = {}) {
  const game = { id: "fixture-cbb-001", start: "2026-11-04T19:00:00Z",
    home_name: "Test Home", away_name: "Test Away", home_abbr: "H", away_abbr: "A" };
  const prediction = { id: "fixture-frozen-001", game_id: game.id, model_version: "FROZEN_CBB_FIXTURE",
    projection_kind: "pregame", proj_home: projectedHome, proj_away: 68,
    proj_total: projectedHome + 68, proj_margin: projectedHome - 68, p_home_final: 0.6,
    p_market: 0.55, frozen_at: "2026-11-04T16:00:00Z",
    weights_json: '{"frozen":true}', layers_json: '{"version":1}',
    deployment_commit: "immutable-fixture-sha", projection_flags: null };
  return { prepare(sql) {
    const text = String(sql);
    const rows = text.includes("PRAGMA table_info(prediction_snapshots)")
      ? Object.keys(prediction).map(name => ({ name }))
      : text.includes("FROM prediction_snapshots") ? [prediction]
        : text.includes("FROM games") ? [game] : [];
    return { bind() { return this; },
      async all() { return { results: rows }; }, async first() { return rows[0] || null; } };
  }};
}

test("CBB populated immutable A/A fixture passes rehearsal without granting live cutover", async () => {
  const primary = populatedD1(), shard = populatedD1();
  const env = { DB: primary, CBB_DB: shard, CORE_DB: inertD1(),
    SPORT_DB_MODE_CBB: "shadow", SPORT_DB_STRICT_CBB: "true",
    SPORT_DB_LEDGER_READY_CBB: "true" };
  const success = await rehearseSportCutover(env, "cbb");
  assert.equal(success.ok, true, JSON.stringify(success.steps.filter(s => !s.ok)));
  assert.equal(success.steps.find(s => s.step === "cbb_populated_live_board_required")?.ok, true);
  assert.equal(success.boardComparison.baselineVsSport.ok, true);
  assert.equal(success.productionCutoverBlocked, true);
  assert.equal(success.canAuthorizeWager, false);
  assert.equal(env.SPORT_DB_MODE_CBB, "shadow");
  assert.equal(env.SPORT_CUTOVER_RECEIPT_CBB, undefined);

  const divergent = await rehearseSportCutover({ ...env, CBB_DB: populatedD1({ projectedHome: 73 }) }, "cbb");
  assert.equal(divergent.ok, false);
  assert.equal(divergent.boardComparison.baselineVsSport.ok, false);
  assert.equal(divergent.canAuthorizeWager, false);
});
