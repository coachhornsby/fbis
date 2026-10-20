import test from "node:test";
import assert from "node:assert/strict";
import {
  sportMigrationScope,
  ensureMirroredSportTable,
  copyPrefixedTablePaged,
  syncSportWorkingDelta,
  SPORT_PREFIX_TABLES,
} from "../functions/lib/sportWorkingCopy.js";

function memoryDb(seed = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, { cols: null, rows: [...rows] });
  return {
    prepare(sql) {
      const s = String(sql);
      return {
        bind(...args) {
          return this._run(args);
        },
        async first(...args) { return (await this._run(args).first()); },
        async all(...args) { return this._run(args).all(); },
        async run(...args) { return this._run(args).run(); },
        _run(args) {
          return {
            async first() {
              if (s.includes("sqlite_master")) {
                const m = s.match(/name=['"]?(\w+)/) || null;
                // bind form: name=?
                const name = args[0];
                return tables.has(name) ? { ok: 1 } : null;
              }
              if (s.startsWith("PRAGMA table_info")) {
                return null;
              }
              if (s.includes("SELECT COUNT(*)")) {
                const sport = args[0];
                const table = s.includes("prediction_snapshots") ? "prediction_snapshots"
                  : s.includes("published_projections") ? "published_projections"
                    : s.includes("FROM games") ? "games" : null;
                const rows = (tables.get(table)?.rows || []).filter((r) => !sport || r.sport === sport);
                return { n: rows.length };
              }
              return null;
            },
            async all() {
              if (s.startsWith("PRAGMA table_info")) {
                const table = s.match(/table_info\((\w+)\)/)?.[1];
                const rows = tables.get(table)?.rows || [];
                const sample = rows[0] || { id: null };
                const cols = Object.keys(sample).map((name, i) => ({
                  cid: i,
                  name,
                  type: typeof sample[name] === "number" ? "REAL" : "TEXT",
                  notnull: 0,
                  dflt_value: null,
                  pk: name === "id" || name === "team_key" || name === "player_key" ? 1 : 0,
                }));
                return { results: cols };
              }
              if (s.includes("SELECT") && s.includes("FROM")) {
                const table = s.match(/FROM\s+(\w+)/i)?.[1];
                let rows = [...(tables.get(table)?.rows || [])];
                if (s.includes("WHERE") && args.length) {
                  const key = args[0];
                  const pk = Object.keys(rows[0] || { id: 1 }).find((k) => k === "id" || k === "team_key" || k === "player_key") || "id";
                  rows = rows.filter((r) => String(r[pk]) > String(key));
                }
                rows.sort((a, b) => String(a.id || a.team_key || a.player_key).localeCompare(String(b.id || b.team_key || b.player_key)));
                const lim = Number(args[args.length - 1]) || rows.length;
                return { results: rows.slice(0, lim) };
              }
              return { results: [] };
            },
            async run() {
              if (s.startsWith("CREATE TABLE")) {
                const table = s.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
                if (table && !tables.has(table)) tables.set(table, { cols: null, rows: [] });
                return { meta: { changes: 0 } };
              }
              if (s.startsWith("INSERT")) {
                const table = s.match(/INTO\s+(\w+)/i)?.[1];
                const colMatch = s.match(/\(([^)]+)\)\s*VALUES/);
                const cols = colMatch ? colMatch[1].split(",").map((c) => c.trim()) : [];
                const row = {};
                cols.forEach((c, i) => { row[c] = args[i]; });
                const bucket = tables.get(table) || { rows: [] };
                const pk = cols.find((c) => c === "id" || c === "team_key" || c === "player_key") || cols[0];
                bucket.rows = bucket.rows.filter((r) => String(r[pk]) !== String(row[pk]));
                bucket.rows.push(row);
                tables.set(table, bucket);
                return { meta: { changes: 1 } };
              }
              if (s.includes("fbis_sport_shard_meta")) {
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
    _tables: tables,
  };
}

test("NFL migration scope lists prefix tables and defers player props", () => {
  const scope = sportMigrationScope("nfl");
  assert.ok(scope.prefixTables.includes("nfl_team_profiles"));
  assert.ok(scope.prefixTables.includes("nfl_player_profiles"));
  assert.equal(scope.deferredPlayerProps, true);
  assert.ok(!scope.prefixTables.some((t) => t.includes("prop")));
  assert.equal(SPORT_PREFIX_TABLES.nfl.length, scope.prefixTables.length);
});

test("ensureMirroredSportTable creates destination schema from PRIMARY pragma", async () => {
  const primary = memoryDb({
    nfl_team_profiles: [{ team_key: "KC", team_name: "Chiefs", season: 2026 }],
  });
  const sport = memoryDb({});
  const mirror = await ensureMirroredSportTable(primary, sport, "nfl_team_profiles");
  assert.equal(mirror.ok, true);
  assert.equal(mirror.skipped, false);
  const again = await ensureMirroredSportTable(primary, sport, "nfl_team_profiles");
  assert.equal(again.skipped, true);
});

test("copyPrefixedTablePaged mirrors rows idempotently", async () => {
  const primary = memoryDb({
    nfl_team_profiles: [
      { team_key: "KC", team_name: "Chiefs", season: 2026 },
      { team_key: "BUF", team_name: "Bills", season: 2026 },
    ],
  });
  const sport = memoryDb({});
  const first = await copyPrefixedTablePaged(primary, sport, "nfl_team_profiles", { pageSize: 10, maxPages: 2 });
  assert.equal(first.ok, true);
  assert.equal(first.copied, 2);
  const second = await copyPrefixedTablePaged(primary, sport, "nfl_team_profiles", { pageSize: 10, maxPages: 2 });
  assert.equal(second.copied, 2); // INSERT OR REPLACE
  assert.equal(sport._tables.get("nfl_team_profiles").rows.length, 2);
});

test("syncSportWorkingDelta refuses while sport mode is active", async () => {
  const primary = memoryDb({
    games: [{ id: "g1", sport: "nfl", start: "2026-10-01" }],
    prediction_snapshots: [],
    published_projections: [],
  });
  const nfl = memoryDb({
    games: [],
    prediction_snapshots: [],
    published_projections: [],
  });
  const env = {
    DB: primary,
    NFL_DB: nfl,
    SPORT_DB_MODE_NFL: "sport",
    SPORT_CUTOVER_RECEIPT_NFL: "x",
    __fbisCutoverApprovals: new Map([["nfl:x", { status: "APPROVED", receipt_id: "x", sport: "nfl" }]]),
  };
  const blocked = await syncSportWorkingDelta(env, "nfl", { rounds: 1 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason || "", /REFUSED_WHILE_SPORT_MODE|SPORT/);
});
