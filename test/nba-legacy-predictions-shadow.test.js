import test from "node:test";
import assert from "node:assert/strict";
import {
  workingTablesForSport,
  copyNbaLegacyPredictionsPaged,
  fullFidelitySportUpsertSql,
} from "../functions/lib/sportWorkingCopy.js";

function source(rows) {
  return {
    prepare(sql) {
      assert.match(sql, /SELECT \* FROM predictions WHERE sport='nba' AND id>\?/);
      return { bind(cursor, limit) {
        return { async all() {
          return { results: rows.filter(r => r.sport === "nba" && r.id > cursor)
            .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit) };
        }};
      }};
    },
  };
}

function destination() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      assert.match(sql, /^INSERT INTO predictions\(/);
      const fields = sql.match(/^INSERT INTO predictions\(([^)]+)\)/)?.[1]?.split(",") || [];
      return { bind(...values) {
        return { async run() {
          const row = Object.fromEntries(fields.map((k, i) => [k, values[i]]));
          rows.set(row.id, row);
          return { success: true };
        }};
      }};
    },
    async batch(statements) { for (const s of statements) await s.run(); },
  };
}

test("only NBA adds generic predictions to working-set parity", () => {
  assert.deepEqual(workingTablesForSport("nba").map(x => x.table),
    ["games", "prediction_snapshots", "published_projections", "predictions"]);
  for (const sport of ["nfl", "cfb", "nhl", "cbb", "mlb", "tennis"]) {
    assert.deepEqual(workingTablesForSport(sport).map(x => x.table),
      ["games", "prediction_snapshots", "published_projections"]);
  }
});

test("NBA predictions upsert retains source grading fields and rejects duplicate IDs", async () => {
  const rows = [
    { id: "a", sport: "nba", game_id: "g1", date: "2026-10-23", graded_at: null, actual_home: null },
    { id: "b", sport: "nba", game_id: "g2", date: "2026-10-23", graded_at: "2026-10-23T00:00:00Z", actual_home: 104 },
    { id: "c", sport: "nba", game_id: "g3", date: "2026-10-23", graded_at: null, actual_home: null },
    { id: "nfl1", sport: "nfl", game_id: "g9", date: "2026-10-23", graded_at: null, actual_home: null },
  ];
  const target = destination();
  const first = await copyNbaLegacyPredictionsPaged(source(rows), target, { pageSize: 2, maxPages: 1 });
  assert.equal(first.copied, 2);
  assert.equal(first.exhausted, false);
  const second = await copyNbaLegacyPredictionsPaged(source(rows), target, { pageSize: 2, maxPages: 2, afterId: first.cursor });
  assert.equal(second.copied, 1);
  assert.equal(second.exhausted, true);
  assert.equal(target.rows.size, 3);
  assert.equal(target.rows.get("b").actual_home, 104);
  rows[0].graded_at = "2026-10-24T00:00:00Z";
  rows[0].actual_home = 117;
  await copyNbaLegacyPredictionsPaged(source(rows), target, { pageSize: 10, maxPages: 2 });
  assert.equal(target.rows.size, 3);
  assert.equal(target.rows.get("a").actual_home, 117);
  assert.equal(target.rows.get("a").graded_at, "2026-10-24T00:00:00Z");
});

test("generic upsert retains all source columns and targets id only", () => {
  const sql = fullFidelitySportUpsertSql("predictions", ["id", "game_id", "graded_at", "actual_home"]);
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE/);
  assert.match(sql, /graded_at=excluded.graded_at/);
});
