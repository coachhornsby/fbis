import test from "node:test";
import assert from "node:assert/strict";
import { verifyNhlRecordLevelParity } from "../functions/lib/nhlSportDb.js";

test("NHL record-level parity matches sampled games and projections", async () => {
  const games = new Map([
    ["g1", { id: "g1", start: "2026-10-20T00:00:00Z", home_name: "H", away_name: "A", home_abbr: "H", away_abbr: "A" }],
  ]);
  const preds = new Map([
    ["p1", {
      id: "p1", game_id: "g1", model_version: "v1", projection_kind: "FBIS",
      proj_total: 6.5, proj_home: 3.2, proj_away: 3.3, p_home_final: 0.48, frozen_at: "2026-10-19T22:00:00Z",
    }],
  ]);

  function storeDb(map, listSqlIncludes) {
    return {
      prepare(sql) {
        if (sql.includes("FROM games") && sql.includes("ORDER BY")) {
          return { bind() { return { async all() { return { results: [...map.values()] }; } }; } };
        }
        if (sql.includes("FROM prediction_snapshots") && sql.includes("ORDER BY")) {
          return { bind() { return { async all() { return { results: [...preds.values()] }; } }; } };
        }
        if (sql.includes("FROM games WHERE id=?")) {
          return { bind(id) { return { async first() { return map.get(id) || null; } }; } };
        }
        if (sql.includes("FROM prediction_snapshots WHERE id=?")) {
          return { bind(id) { return { async first() { return preds.get(id) || null; } }; } };
        }
        if (sql.includes("nhl_parity_receipts")) {
          return { bind() { return { async run() { return { meta: { changes: 1 } }; } }; } };
        }
        return { bind() { return { async first() { return null; }, async all() { return { results: [] }; }, async run() { return {}; } }; } };
      },
    };
  }

  const primary = storeDb(games);
  const nhl = storeDb(games);
  const report = await verifyNhlRecordLevelParity({ DB: primary, NHL_DB: nhl }, { sampleSize: 10 });
  assert.equal(report.ok, true);
  assert.equal(report.status, "RECORD_PARITY_OK");
  assert.equal(report.games.matched, 1);
  assert.equal(report.predictions.matched, 1);
  assert.equal(report.productIoUsesSportDb, false);
});

test("NHL record-level parity reports missing sport rows", async () => {
  const primary = {
    prepare(sql) {
      if (sql.includes("FROM games") && sql.includes("ORDER BY")) {
        return { bind() { return { async all() { return { results: [{ id: "g1", start: "t", home_name: "H", away_name: "A", home_abbr: "H", away_abbr: "A" }] }; } }; } };
      }
      if (sql.includes("FROM prediction_snapshots") && sql.includes("ORDER BY")) {
        return { bind() { return { async all() { return { results: [] }; } }; } };
      }
      return { bind() { return { async first() { return null; }, async run() { return {}; } }; } };
    },
  };
  const nhl = {
    prepare() {
      return { bind() { return { async first() { return null; }, async run() { return {}; } }; } };
    },
  };
  const report = await verifyNhlRecordLevelParity({ DB: primary, NHL_DB: nhl }, { sampleSize: 5 });
  assert.equal(report.ok, false);
  assert.equal(report.games.status, "DIVERGED");
  assert.equal(report.gameSample[0].status, "MISSING");
});
