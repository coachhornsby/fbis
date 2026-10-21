import test from "node:test";
import assert from "node:assert/strict";
import {
  verifySportRecordLevelParity,
  buildSportSyncHealth,
  qualifySportMigration,
  SPORT_MIGRATION_QUALIFY_CONTRACT,
} from "../functions/lib/sportMigrationQualify.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function memoryDb(seed = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, [...rows]);
  return {
    prepare(sql) {
      const s = String(sql);
      return {
        bind(...args) {
          return this._run(args);
        },
        async first(...a) { return this._run(a).first(); },
        async all(...a) { return this._run(a).all(); },
        async run(...a) { return this._run(a).run(); },
        _run(args) {
          return {
            async first() {
              if (s.includes("COUNT(*)")) {
                const sport = args[0];
                const table = s.includes("prediction_snapshots") ? "prediction_snapshots"
                  : s.includes("published_projections") ? "published_projections"
                    : s.includes("FROM games") ? "games" : null;
                const rows = (tables.get(table) || []).filter((r) => !sport || r.sport === sport);
                return { n: rows.length };
              }
              if (s.includes("fbis_sport_shard_meta")) {
                return { value_text: "2026-10-20T18:00:00.000Z", updated_at: "2026-10-20T18:00:00.000Z" };
              }
              if (s.includes("FROM games WHERE id=")) {
                return (tables.get("games") || []).find((r) => r.id === args[0]) || null;
              }
              if (s.includes("FROM prediction_snapshots WHERE id=")) {
                return (tables.get("prediction_snapshots") || []).find((r) => r.id === args[0]) || null;
              }
              return null;
            },
            async all() {
              if (s.includes("FROM games")) {
                let rows = [...(tables.get("games") || [])];
                if (args[0]) rows = rows.filter((r) => r.sport === args[0]);
                const lim = Number(args[args.length - 1]) || rows.length;
                return { results: rows.slice(0, lim) };
              }
              if (s.includes("FROM prediction_snapshots")) {
                let rows = [...(tables.get("prediction_snapshots") || [])];
                if (args[0]) rows = rows.filter((r) => r.sport === args[0]);
                const lim = Number(args[args.length - 1]) || rows.length;
                return { results: rows.slice(0, lim) };
              }
              return { results: [] };
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

test("record-level parity matches identical primary/sport rows", async () => {
  const rows = {
    games: [{
      id: "g1", sport: "nfl", start: "2026-10-20T00:00Z",
      home_name: "A", away_name: "B", home_abbr: "A", away_abbr: "B",
    }],
    prediction_snapshots: [{
      id: "p1", sport: "nfl", game_id: "g1", model_version: "v1",
      projection_kind: "ml", proj_total: 45, proj_home: 24, proj_away: 21,
      p_home_final: 0.55, frozen_at: "2026-10-20T01:00:00.000Z",
    }],
    published_projections: [],
    fbis_sport_shard_meta: [],
    sport_parity_receipts: [],
  };
  const db = memoryDb(rows);
  const env = { DB: db, NFL_DB: db };
  const result = await verifySportRecordLevelParity(env, "nfl", { sampleSize: 10 });
  assert.equal(result.contract, SPORT_MIGRATION_QUALIFY_CONTRACT);
  assert.equal(result.ok, true);
  assert.equal(result.cutoverAuthorized, false);
  assert.equal(result.canAuthorizeWager, false);
});

test("sync health reports lag and keeps cutover closed", async () => {
  const db = memoryDb({ games: [], prediction_snapshots: [], published_projections: [] });
  const env = { DB: db, NFL_DB: db };
  const health = await buildSportSyncHealth(env, "nfl", {
    now: new Date("2026-10-20T18:30:00.000Z"),
    maxLagMs: 60 * 60 * 1000,
  });
  assert.equal(health.productStillPrimary, true);
  assert.equal(health.cutoverAuthorized, false);
  assert.equal(health.lagOk, true);
});

test("qualify package never activates cutover or deletion", async () => {
  const rows = {
    games: [{
      id: "g1", sport: "nfl", start: "2026-10-20T00:00Z",
      home_name: "A", away_name: "B", home_abbr: "A", away_abbr: "B",
    }],
    prediction_snapshots: [{
      id: "p1", sport: "nfl", game_id: "g1", model_version: "v1",
      projection_kind: "ml", proj_total: 45, proj_home: 24, proj_away: 21,
      p_home_final: 0.55, frozen_at: "2026-10-20T01:00:00.000Z",
    }],
    published_projections: [],
  };
  const db = memoryDb(rows);
  const env = { DB: db, NFL_DB: db };
  const q = await qualifySportMigration(env, "nfl", {
    runDeltaSync: false,
    runCutoverRehearsal: false,
    sampleSize: 5,
  });
  assert.equal(q.activationPerformed, false);
  assert.equal(q.cutoverAuthorized, false);
  assert.equal(q.deletionAuthorized, false);
  assert.equal(q.canAuthorizeWager, false);
  assert.ok(q.prefixParity);
  assert.ok(q.migrationCompleteness);
  // Working-set parity alone must not claim a complete sport migration.
  assert.equal(typeof q.migrationCompleteness.fullSportIncludingPrefix, "boolean");
});

test("empty NPB/KBO shards cannot satisfy real-source cutover qualification", async () => {
  for (const sport of ["npb", "kbo"]) {
    const db = memoryDb({
      games: [], prediction_snapshots: [], published_projections: [],
    });
    const env = { DB: db, [sport.toUpperCase() + "_DB"]: db };
    const q = await qualifySportMigration(env, sport, {
      runDeltaSync: false,
      runCutoverRehearsal: false,
      sampleSize: 10,
    });
    assert.equal(q.gates.sourceCoverage, false, sport);
    assert.equal(q.gates.prefixParity, false, sport);
    assert.equal(q.readyForCutoverReview, false, sport);
    assert.equal(q.migrationCompleteness.fullSportIncludingPrefix, false, sport);
    assert.equal(q.cutoverAuthorized, false, sport);
  }
});

test("qualify workflow keeps deletion and cutover closed", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const wf = readFileSync(join(root, ".github/workflows/sport-migration-qualify.yml"), "utf8");
  assert.match(wf, /cutoverAuthorized==false/);
  assert.match(wf, /deletionAuthorized==false/);
  assert.match(wf, /activationPerformed==false/);
  assert.match(wf, /sport: nfl/);
  // Cutover sports must fail CI when readyForCutoverReview is false.
  assert.match(wf, /readyForCutoverReview==true/);
  assert.match(wf, /gates\.cutoverRehearsal==true/);
  assert.match(wf, /RUN_CUTOVER_REHEARSAL/);
});
