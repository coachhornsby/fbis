import test from "node:test";
import assert from "node:assert/strict";
import {
  copySportWorkingTables,
  verifySportWorkingParity,
  reconcileSportProjections,
} from "../functions/lib/sportWorkingCopy.js";

function makePrimary({ games = [], preds = [], pubs = [] } = {}) {
  return {
    prepare(sql) {
      const s = String(sql);
      if (s.includes("COUNT(*)") && s.includes("FROM games")) {
        return { bind() { return { async first() { return { n: games.length }; } }; } };
      }
      if (s.includes("COUNT(*)") && s.includes("FROM prediction_snapshots")) {
        return { bind() { return { async first() { return { n: preds.length }; } }; } };
      }
      if (s.includes("COUNT(*)") && s.includes("FROM published_projections")) {
        return { bind() { return { async first() { return { n: pubs.length }; } }; } };
      }
      if (s.includes("FROM games") && s.includes("id>?")) {
        return {
          bind(_sport, afterId, limit) {
            return {
              async all() {
                const rows = games
                  .filter((g) => g.id > afterId)
                  .sort((a, b) => (a.id < b.id ? -1 : 1))
                  .slice(0, limit);
                return { results: rows };
              },
            };
          },
        };
      }
      if (s.includes("FROM prediction_snapshots") && s.includes("id>?")) {
        return {
          bind(_sport, afterId, limit) {
            return {
              async all() {
                const rows = preds
                  .filter((p) => p.id > afterId)
                  .sort((a, b) => (a.id < b.id ? -1 : 1))
                  .slice(0, limit);
                return { results: rows };
              },
            };
          },
        };
      }
      if (s.includes("FROM published_projections")) {
        return {
          bind(_sport, afterKey, limit) {
            return {
              async all() {
                const keyOf = (r) => `${r.published_at}|${r.game_id}|${r.model_version || ""}`;
                const rows = pubs
                  .filter((p) => keyOf(p) > afterKey)
                  .sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1))
                  .slice(0, limit);
                return { results: rows };
              },
            };
          },
        };
      }
      if (s.includes("FROM prediction_snapshots") && s.includes("ORDER BY frozen_at")) {
        return {
          bind(_sport, limit) {
            return {
              async all() {
                return { results: preds.slice(0, limit) };
              },
            };
          },
        };
      }
      return { bind() { return { async all() { return { results: [] }; }, async first() { return { n: 0 }; } }; } };
    },
  };
}

function makeSportStore() {
  const store = {
    games: new Map(),
    prediction_snapshots: new Map(),
    published_projections: new Map(),
    meta: new Map(),
  };
  const sportDb = {
    prepare(sql) {
      const s = String(sql);
      if (s.startsWith("INSERT INTO games") || s.startsWith("INSERT OR REPLACE INTO games")) {
        return {
          bind(...args) {
            return {
              async run() {
                store.games.set(args[0], args);
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      }
      if (s.startsWith("INSERT INTO prediction_snapshots") || s.startsWith("INSERT OR REPLACE INTO prediction_snapshots")) {
        return {
          bind(...args) {
            return {
              async run() {
                store.prediction_snapshots.set(args[0], args);
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      }
      if (s.startsWith("INSERT INTO published_projections") || s.startsWith("INSERT OR REPLACE INTO published_projections")) {
        return {
          bind(...args) {
            return {
              async run() {
                store.published_projections.set(args[0], args);
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      }
      if (s.includes("fbis_sport_shard_meta") && s.includes("INSERT")) {
        return {
          bind(key, value) {
            return {
              async run() {
                store.meta.set(key, value);
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      }
      if (s.includes("FROM fbis_sport_shard_meta")) {
        return {
          bind(key) {
            return {
              async first() {
                const v = store.meta.get(key);
                return v == null ? null : { value_text: v };
              },
            };
          },
        };
      }
      if (s.includes("COUNT(*)") && s.includes("FROM games")) {
        return { bind() { return { async first() { return { n: store.games.size }; } }; } };
      }
      if (s.includes("COUNT(*)") && s.includes("FROM prediction_snapshots")) {
        return { bind() { return { async first() { return { n: store.prediction_snapshots.size }; } }; } };
      }
      if (s.includes("COUNT(*)") && s.includes("FROM published_projections")) {
        return { bind() { return { async first() { return { n: store.published_projections.size }; } }; } };
      }
      if (s.includes("FROM prediction_snapshots WHERE id=?")) {
        return {
          bind(id) {
            return {
              async first() {
                const row = store.prediction_snapshots.get(id);
                if (!row) return null;
                // Bind order matches copyPredictionsPaged INSERT columns.
                return {
                  id: row[0],
                  game_id: row[1],
                  sport: row[2],
                  model_version: row[3],
                  projection_kind: row[4],
                  proj_total: row[5],
                  proj_home: row[6],
                  proj_away: row[7],
                  proj_margin: row[8],
                  p_home_final: row[9],
                  p_market: row[10],
                  frozen_at: row[11],
                  payload_json: row[19],
                };
              },
            };
          },
        };
      }
      if (s.includes("sport_parity_receipts")) {
        return { bind() { return { async run() { return { meta: { changes: 1 } }; } }; } };
      }
      return { bind() { return { async first() { return null; }, async run() { return {}; }, async all() { return { results: [] }; } }; } };
    },
  };
  return { store, sportDb };
}

test("paged sport copy reaches older prediction rows across pages", async () => {
  const preds = Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`,
    game_id: `g${i}`,
    sport: "nfl",
    model_version: "v1",
    projection_kind: "FBIS",
    proj_total: 40 + i,
    proj_home: 20,
    proj_away: 20,
    p_home_final: 0.5,
    frozen_at: `2026-10-0${i + 1}T00:00:00Z`,
  }));
  const games = preds.map((p, i) => ({
    id: `g${i}`, sport: "nfl", start: p.frozen_at,
    home_name: "H", away_name: "A", home_abbr: "H", away_abbr: "A",
  }));
  const pubs = [{
    game_id: "g0", sport: "nfl", model_version: "v1",
    published_at: "2026-10-01T00:00:00Z", payload_json: "{}",
  }];
  const { store, sportDb } = makeSportStore();
  const env = {
    DB: makePrimary({ games, preds, pubs }),
    NFL_DB: sportDb,
    SPORT_DB_MODE_NFL: "shadow",
  };

  const first = await copySportWorkingTables(env, "nfl", { pageSize: 2, maxPages: 2, resume: true });
  assert.equal(first.ok, true);
  assert.ok(first.results.find((r) => r.table === "prediction_snapshots").copied >= 2);

  const second = await copySportWorkingTables(env, "nfl", { pageSize: 2, maxPages: 5, resume: true });
  assert.equal(second.ok, true);
  assert.equal(store.prediction_snapshots.size, 5);
  assert.equal(store.games.size, 5);
  assert.equal(store.published_projections.size, 1);

  const parity = await verifySportWorkingParity(env, "nfl");
  assert.equal(parity.ok, true);

  const reconcile = await reconcileSportProjections(env, "nfl", { sampleSize: 5 });
  assert.equal(reconcile.ok, true);
  assert.equal(reconcile.counts.published_projections.status, "PARITY");
});

test("sport copy refuses while sport mode is active", async () => {
  const { sportDb } = makeSportStore();
  const env = {
    DB: makePrimary(),
    NFL_DB: sportDb,
    SPORT_DB_MODE_NFL: "sport",
    SPORT_CUTOVER_RECEIPT_NFL: "nfl-receipt",
  };
  const result = await copySportWorkingTables(env, "nfl");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "REFUSED_WHILE_SPORT_MODE_ACTIVE");
});
