import test from "node:test";
import assert from "node:assert/strict";
import { rehearseSportCutover } from "../functions/lib/sportCutoverRehearsal.js";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";

function pred(id) {
  return {
    id,
    game_id: `g-${id}`,
    model_version: "v1",
    projection_kind: "FBIS",
    proj_total: 45,
    proj_home: 24,
    proj_away: 21,
    proj_margin: 3,
    p_home_final: 0.55,
    p_market: 0.52,
    frozen_at: "2026-10-20T00:00:00Z",
    weights_json: "{\"market\":0.4}",
    layers_json: "{\"market\":0.52}",
    projection_flags: null,
    graded_at: null,
    deployment_commit: "abc123",
    payload_json: JSON.stringify({
      contract: "fbis-canonical-evidence-v1",
      source: "PRIMARY",
      row: { id },
    }),
  };
}

function db(tag, { games = [], preds = [] } = {}) {
  const gameRows = games.map((id) => ({
    id, start: "2026-10-20T00:00:00Z", home_name: "H", away_name: "A", home_abbr: "H", away_abbr: "A",
  }));
  const predRows = preds.map((id) => (typeof id === "string" ? pred(id) : id));
  return {
    tag,
    prepare(sql) {
      const s = String(sql);
      if (s.includes("FROM games")) {
        return {
          bind() {
            return {
              async all() { return { results: gameRows }; },
              async first() { return { n: gameRows.length }; },
            };
          },
        };
      }
      if (s.includes("FROM prediction_snapshots")) {
        return {
          bind() {
            return {
              async all() { return { results: predRows }; },
              async first() { return { n: predRows.length }; },
            };
          },
        };
      }
      return {
        bind() { return this; },
        async first() { return { n: 0 }; },
        async all() { return { results: [] }; },
        async run() { return { meta: { changes: 0 } }; },
      };
    },
  };
}

test("cutover rehearsal keeps primary authoritative and proves rollback", async () => {
  const primary = db("primary", { games: ["g1", "g2"], preds: ["p1", "p2"] });
  const nhl = db("nhl", { games: ["g1", "g2"], preds: ["p1", "p2"] });
  const env = {
    DB: primary,
    NHL_DB: nhl,
    NHL_SPORT_DB_MODE: "shadow",
    SPORT_DB_MODE_NHL: "shadow",
  };

  const report = await rehearseSportCutover(env, "nhl", {
    injectMissingBinding: true,
    injectStaleCore: true,
  });
  assert.equal(report.liveCutoverAuthorized, false);
  assert.equal(report.productionCutoverBlocked, true);
  assert.equal(report.deployedStillAuthoritative, true);
  assert.equal(report.ok, true);
  assert.equal(productSportDbHandle(env, "nhl").productIoUsesSportDb, false);
});

test("rehearsal simulated sport switch activates only in-process with receipt", async () => {
  const primary = db("primary", { games: ["g1"], preds: ["p1"] });
  const nfl = db("nfl", { games: ["g1"], preds: ["p1"] });
  const env = {
    DB: primary,
    NFL_DB: nfl,
    SPORT_DB_MODE_NFL: "shadow",
  };
  const report = await rehearseSportCutover(env, "nfl");
  assert.equal(report.ok, true);
  const sportStep = report.steps.find((s) => s.step === "simulated_sport_switch");
  assert.equal(sportStep.fingerprint.productIoUsesSportDb, true);
  const receiptStep = report.steps.find((s) => s.step === "sport_mode_requires_cutover_receipt");
  assert.equal(receiptStep.ok, true);
  const compareStep = report.steps.find((s) => s.step === "baseline_vs_sport_output_compare");
  assert.equal(compareStep.ok, true);
  const consumers = report.steps.find((s) => s.step === "consumers_read_primary_until_cutover");
  assert.equal(consumers.ok, true);
  const writes = report.steps.find((s) => s.step === "writes_stay_primary_until_receipt");
  assert.equal(writes.ok, true);
  const models = report.steps.find((s) => s.step === "model_versions_preserved");
  assert.equal(models.ok, true);
  const rollback = report.steps.find((s) => s.step === "rollback_to_shadow");
  assert.equal(rollback.ok, true);
  assert.equal(report.authorityActivationRequested, false);
  assert.equal(report.liveCutoverAuthorized, false);
  // Live env untouched
  assert.equal(productSportDbHandle(env, "nfl").productIoUsesSportDb, false);
  assert.equal(env.SPORT_DB_MODE_NFL, "shadow");
});

test("partial sport injection fails fidelity / output compare", async () => {
  const primary = db("primary", { games: ["g1", "g2"], preds: ["p1", "p2", "p3", "p4"] });
  const nfl = db("nfl", { games: ["g1", "g2"], preds: ["p1", "p2", "p3", "p4"] });
  const env = {
    DB: primary,
    NFL_DB: nfl,
    SPORT_DB_MODE_NFL: "shadow",
  };
  const report = await rehearseSportCutover(env, "nfl", { injectPartialSport: true });
  assert.equal(report.ok, true);
  const partial = report.steps.find((s) => s.step === "partial_data_injection_detected");
  assert.equal(partial.ok, true);
  assert.equal(partial.injected, true);
});
