import test from "node:test";
import assert from "node:assert/strict";
import {
  sportMigrationScope,
  ensureMirroredSportTable,
  copyPrefixedTablePaged,
  copySportPrefixTables,
  verifySportPrefixParity,
  syncSportWorkingDelta,
  SPORT_PREFIX_TABLES,
  SPORT_SYNC_SPORTS,
  isSportSyncEligible,
} from "../functions/lib/sportWorkingCopy.js";
import { FBIS_SPORTS } from "../functions/lib/databaseTopology.js";

function memoryDb(seed = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) {
    const sample = rows[0] || {};
    tables.set(name, { cols: Object.keys(sample), rows: [...rows] });
  }
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
                const name = args[0];
                return tables.has(name) ? { ok: 1 } : null;
              }
              if (s.startsWith("PRAGMA table_info")) {
                return null;
              }
              if (s.includes("SELECT COUNT(*)") || s.includes("COUNT(*)")) {
                const sport = args[0];
                const fromTable = s.match(/FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i)?.[1] || null;
                const rows = (tables.get(fromTable)?.rows || []).filter((r) => !sport || r.sport === sport);
                return { n: rows.length };
              }
              return null;
            },
            async all() {
              if (s.startsWith("PRAGMA table_info")) {
                const table = s.match(/table_info\((\w+)\)/)?.[1];
                const bucket = tables.get(table);
                const colNames = bucket?.cols?.length
                  ? bucket.cols
                  : Object.keys(bucket?.rows?.[0] || { id: null });
                const cols = colNames.map((name, i) => ({
                  cid: i,
                  name,
                  type: "TEXT",
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
                if (table && !tables.has(table)) {
                  const body = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
                  const beforePk = body.split(/,\s*PRIMARY KEY/i)[0];
                  const cols = beforePk
                    .split(",")
                    .map((part) => part.trim().split(/\s+/)[0])
                    .filter(Boolean);
                  tables.set(table, { cols, rows: [] });
                }
                return { meta: { changes: 0 } };
              }
              if (s.startsWith("ALTER TABLE")) {
                const m = s.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/i);
                if (m) {
                  const bucket = tables.get(m[1]) || { cols: [], rows: [] };
                  if (!bucket.cols.includes(m[2])) bucket.cols.push(m[2]);
                  tables.set(m[1], bucket);
                }
                return { meta: { changes: 0 } };
              }
              if (s.startsWith("INSERT")) {
                const table = s.match(/INTO\s+(\w+)/i)?.[1];
                const colMatch = s.match(/\(([^)]+)\)\s*VALUES/);
                const cols = colMatch ? colMatch[1].split(",").map((c) => c.trim()) : [];
                const row = {};
                cols.forEach((c, i) => { row[c] = args[i]; });
                const bucket = tables.get(table) || { cols: [...cols], rows: [] };
                const pk = cols.find((c) => c === "id" || c === "team_key" || c === "player_key") || cols[0];
                bucket.rows = bucket.rows.filter((r) => String(r[pk]) !== String(row[pk]));
                bucket.rows.push(row);
                for (const c of cols) if (!bucket.cols.includes(c)) bucket.cols.push(c);
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
  assert.equal(scope.cutoverAuthorized, false);
  assert.ok(!scope.prefixTables.some((t) => t.includes("prop")));
  assert.equal(SPORT_PREFIX_TABLES.nfl.length, scope.prefixTables.length);
});

test("all 11 sports are sync-eligible with no prop tables in prefix sets", () => {
  assert.equal(SPORT_SYNC_SPORTS.length, 11);
  for (const sport of FBIS_SPORTS) {
    assert.equal(isSportSyncEligible(sport), true, sport);
    const scope = sportMigrationScope(sport);
    assert.equal(scope.syncEligible, true, sport);
    assert.equal(scope.cutoverAuthorized, false, sport);
    assert.ok(!scope.prefixTables.some((t) => t.includes("prop")), sport);
  }
  assert.ok(SPORT_PREFIX_TABLES.nba.includes("nba_team_profiles"));
  assert.ok(SPORT_PREFIX_TABLES.mlb.includes("mlb_team_profiles"));
  assert.ok(SPORT_PREFIX_TABLES.tennis.includes("tennis_players"));
  assert.equal(SPORT_PREFIX_TABLES.npb.length, 0);
  assert.equal(SPORT_PREFIX_TABLES.kbo.length, 0);
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

test("ensureMirroredSportTable additively heals missing sport-side columns", async () => {
  const primary = memoryDb({
    nhl_goalie_probability_shadow: [{
      id: "g1",
      event_id: "e1",
      game_start: "2026-10-20T00:00:00Z",
      payload_json: "{}",
    }],
  });
  // Stale lean sport table (pre-drift stub).
  const sport = memoryDb({
    nhl_goalie_probability_shadow: [{ id: "old", payload_json: "{}" }],
  });
  // Seed sport pragma cols from existing row keys only (id, payload_json).
  const healed = await ensureMirroredSportTable(primary, sport, "nhl_goalie_probability_shadow");
  assert.equal(healed.ok, true);
  assert.equal(healed.healed, true);
  assert.ok(healed.addedColumns.includes("event_id"));
  assert.ok(healed.addedColumns.includes("game_start"));
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

test("verifySportPrefixParity distinguishes complete vs incomplete research copy", async () => {
  const primary = memoryDb({
    nfl_team_profiles: [
      { team_key: "KC", team_name: "Chiefs" },
      { team_key: "BUF", team_name: "Bills" },
    ],
    nfl_player_profiles: [
      { player_key: "p1", name: "A" },
      { player_key: "p2", name: "B" },
      { player_key: "p3", name: "C" },
    ],
  });
  const sport = memoryDb({
    nfl_team_profiles: [
      { team_key: "KC", team_name: "Chiefs" },
      { team_key: "BUF", team_name: "Bills" },
    ],
    nfl_player_profiles: [
      { player_key: "p1", name: "A" },
    ],
  });
  // Seed remaining NFL prefix tables as empty on both sides so only player_profiles diverges.
  for (const table of SPORT_PREFIX_TABLES.nfl) {
    if (!primary._tables.has(table)) primary._tables.set(table, { cols: ["id"], rows: [] });
    if (!sport._tables.has(table)) sport._tables.set(table, { cols: ["id"], rows: [] });
  }
  const env = { DB: primary, NFL_DB: sport };
  const parity = await verifySportPrefixParity(env, "nfl");
  assert.equal(parity.ok, false);
  assert.equal(parity.status, "PREFIX_PARITY_INCOMPLETE");
  const players = parity.tables.find((t) => t.table === "nfl_player_profiles");
  assert.equal(players.status, "DIVERGED");
  assert.equal(players.primaryCount, 3);
  assert.equal(players.sportCount, 1);
});

test("copySportPrefixTables skipCaughtUp focuses budget on incomplete tables", async () => {
  const primary = memoryDb({
    nfl_team_profiles: [{ team_key: "KC", team_name: "Chiefs" }],
    nfl_player_profiles: [
      { player_key: "p1", name: "A" },
      { player_key: "p2", name: "B" },
    ],
  });
  const sport = memoryDb({
    nfl_team_profiles: [{ team_key: "KC", team_name: "Chiefs" }],
    nfl_player_profiles: [],
  });
  for (const table of SPORT_PREFIX_TABLES.nfl) {
    if (!primary._tables.has(table)) primary._tables.set(table, { cols: ["id"], rows: [] });
    if (!sport._tables.has(table)) sport._tables.set(table, { cols: ["id"], rows: [] });
  }
  const env = { DB: primary, NFL_DB: sport };
  const result = await copySportPrefixTables(env, "nfl", {
    pageSize: 10,
    maxPages: 2,
    skipCaughtUp: true,
    tables: ["nfl_team_profiles", "nfl_player_profiles"],
  });
  assert.ok(result.skippedCaughtUp.some((s) => s.table === "nfl_team_profiles"));
  assert.ok(result.results.some((r) => r.table === "nfl_player_profiles" && r.copied === 2));
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
