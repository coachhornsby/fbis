import test from "node:test";
import assert from "node:assert/strict";
import {
  topologyManifest,
  resolveCoreDb,
  resolveSportDb,
  resolveMarketHistoryWriteDb,
  listMarketHistoryReadDbs,
  marketHistoryRetentionDecision,
  MARKET_HISTORY_HOT_WINDOW_MS,
  SPORT_DATABASES,
  CORE_DATABASE,
} from "../functions/lib/databaseTopology.js";
import { copyNhlPilotTables, verifyNhlSportDbParity } from "../functions/lib/nhlSportDb.js";
import { bootstrapWriteTarget } from "../functions/api/polymarket-bootstrap.js";
import { resolveWsPersistTarget } from "../services/polymarket-us-stream/wsPersistTarget.mjs";

test("topology manifest names CORE, OPERATIONS, NHL pilot, and partitioned history", () => {
  const m = topologyManifest();
  assert.equal(m.contract, "fbis-database-topology-v2");
  assert.equal(m.core.databaseId, CORE_DATABASE.databaseId);
  assert.equal(SPORT_DATABASES.nhl.databaseId, "a0aa010c-40d3-4d2f-8109-eca4e74e2a73");
  assert.equal(m.marketHistoryPartitions[0].binding, "MARKET_HISTORY_2026Q4_DB");
  assert.ok(m.migrationPhases.includes("pilot_nhl_copy_and_read_parity"));
});

test("resolveCoreDb prefers CORE_DB and falls back to primary", () => {
  const core = { prepare() { return {}; } };
  const primary = { prepare() { return {}; } };
  assert.equal(resolveCoreDb({ CORE_DB: core, DB: primary }).preferred, true);
  assert.equal(resolveCoreDb({ DB: primary }).warning, "CORE_DB_UNBOUND_FALLBACK_PRIMARY");
});

test("resolveSportDb keeps primary authority until mode=sport", () => {
  const nhl = { prepare() { return {}; } };
  const primary = { prepare() { return {}; } };
  const shadow = resolveSportDb({ NHL_DB: nhl, DB: primary, NHL_SPORT_DB_MODE: "shadow" }, "nhl");
  assert.equal(shadow.binding, "DB");
  assert.equal(shadow.reason, "SPORT_DB_SHADOW_PRIMARY_READS");
  assert.equal(shadow.sportDb, nhl);
  const active = resolveSportDb({ NHL_DB: nhl, DB: primary }, "nhl", { mode: "sport" });
  assert.equal(active.binding, "NHL_DB");
  assert.equal(active.preferred, true);
  const unbound = resolveSportDb({ DB: primary }, "nfl");
  assert.equal(unbound.reason, "SPORT_DB_UNBOUND");
  const soccer = { prepare() { return {}; } };
  const soccerShadow = resolveSportDb(
    { SOCCER_DB: soccer, DB: primary, SPORT_DB_MODE_SOCCER: "shadow" },
    "soccer"
  );
  assert.equal(soccerShadow.reason, "SPORT_DB_SHADOW_PRIMARY_READS");
  assert.equal(SPORT_DATABASES.soccer.databaseId, "c275978c-fce9-49c9-a1ce-4e2fcbea6d23");
  assert.equal(SPORT_DATABASES.tennis.databaseId, "c491e479-f9f6-49a9-ace9-962aef68cc64");
  assert.equal(SPORT_DATABASES.nfl.databaseId, "0a49cad0-4bf9-4e01-88ce-be54123f712d");
  assert.equal(SPORT_DATABASES.cfb.databaseId, "b589c91c-c53d-4f4a-9d32-99c4468e3033");
  assert.equal(SPORT_DATABASES.mlb.databaseId, "b188629e-cdf7-49e6-b693-dead80777377");
  assert.equal(SPORT_DATABASES.kbo.pilotStatus, "SCHEMA_READY");
  for (const plan of Object.values(SPORT_DATABASES)) {
    assert.ok(plan.databaseId, `${plan.sport} should be provisioned`);
    assert.notEqual(plan.pilotStatus, "PLANNED");
  }
});

test("market history write prefers 2026Q4 partition when ready and under WATCH", async () => {
  const q4 = {
    prepare(sql) {
      if (String(sql).includes("sqlite_master")) return { bind() { return { async first() { return { ok: 1 }; } }; } };
      return { async all() { return { meta: { size_after: 100_000 } }; } };
    },
  };
  const legacy = {
    prepare(sql) {
      if (String(sql).includes("sqlite_master")) return { bind() { return { async first() { return { ok: 1 }; } }; } };
      return { async all() { return { meta: { size_after: 9_000_000_000 } }; } };
    },
  };
  const target = await resolveMarketHistoryWriteDb({
    MARKET_HISTORY_2026Q4_DB: q4,
    MARKET_HISTORY_DB: legacy,
  });
  assert.equal(target.binding, "MARKET_HISTORY_2026Q4_DB");
  assert.equal(target.store, "MARKET_HISTORY_2026Q4");
  assert.equal(listMarketHistoryReadDbs({
    MARKET_HISTORY_2026Q4_DB: q4,
    MARKET_HISTORY_DB: legacy,
  }).map((p) => p.binding).join(","), "MARKET_HISTORY_2026Q4_DB,MARKET_HISTORY_DB");
});

test("retention policy keeps only the hot window in D1", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const hot = marketHistoryRetentionDecision({
    collectedAt: new Date(now.getTime() - MARKET_HISTORY_HOT_WINDOW_MS + 3600000).toISOString(),
    now,
  });
  assert.equal(hot.retainInD1, true);
  const cold = marketHistoryRetentionDecision({
    collectedAt: new Date(now.getTime() - MARKET_HISTORY_HOT_WINDOW_MS - 3600000).toISOString(),
    now,
  });
  assert.equal(cold.retainInD1, false);
  assert.equal(cold.action, "ARCHIVE_TO_R2_THEN_RETENTION_GATE");
});

test("bootstrap and WS persist targets prefer the 2026Q4 binding when present", () => {
  const q4 = { prepare() { return {}; } };
  const legacy = { prepare() { return {}; } };
  const boot = bootstrapWriteTarget({ MARKET_HISTORY_2026Q4_DB: q4, MARKET_HISTORY_DB: legacy }, 9_600_000_000);
  assert.equal(boot.store, "MARKET_HISTORY_2026Q4");
  const ws = resolveWsPersistTarget({ MARKET_HISTORY_2026Q4_DB: q4, MARKET_HISTORY_DB: legacy });
  assert.equal(ws.store, "MARKET_HISTORY_2026Q4");
  assert.equal(ws.preferHistory, true);
});

test("NHL parity reports unbound without inventing a binding", async () => {
  const report = await verifyNhlSportDbParity({ DB: { prepare() { return { async first() { return { n: 1 }; } }; } } });
  assert.equal(report.ok, false);
  assert.equal(report.reason, "NHL_DB_UNBOUND");
});

test("NHL copy is a no-op without NHL_DB", async () => {
  const result = await copyNhlPilotTables({ DB: { prepare() { return {}; } } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "NHL_DB_UNBOUND");
});

test("NHL copy and parity succeed on in-memory fixtures", async () => {
  const primaryGames = [{
    id: "nhl-1", sport: "nhl", start: "2026-10-20T23:00:00Z",
    home_name: "Home", away_name: "Away", home_abbr: "H", away_abbr: "A",
  }];
  const primaryPreds = [{
    id: "pred-1", game_id: "nhl-1", sport: "nhl", model_version: "v1",
    projection_kind: "FBIS", proj_total: 6, proj_home: 3, proj_away: 3,
    p_home_final: 0.5, frozen_at: "2026-10-20T12:00:00Z",
  }];
  const sportStore = {
    games: new Map(),
    prediction_snapshots: new Map(),
    published_projections: new Map(),
    meta: new Map(),
    parity: [],
  };
  const primary = {
    prepare(sql) {
      if (sql.includes("FROM games")) {
        return { bind() { return { async all() { return { results: primaryGames }; }, async first() { return { n: primaryGames.length }; } }; } };
      }
      if (sql.includes("FROM prediction_snapshots")) {
        return { bind() { return { async all() { return { results: primaryPreds }; }, async first() { return { n: primaryPreds.length }; } }; } };
      }
      if (sql.includes("FROM published_projections")) {
        return { bind() { return { async all() { return { results: [] }; }, async first() { return { n: 0 }; } }; } };
      }
      return { bind() { return { async all() { return { results: [] }; }, async first() { return { n: 0 }; } }; } };
    },
  };
  const nhl = {
    prepare(sql) {
      if (sql.startsWith("INSERT OR REPLACE INTO games")) {
        return {
          bind(...args) {
            return {
              async run() {
                sportStore.games.set(args[0], args);
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      }
      if (sql.startsWith("INSERT OR REPLACE INTO prediction_snapshots")) {
        return {
          bind(...args) {
            return {
              async run() {
                sportStore.prediction_snapshots.set(args[0], args);
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      }
      if (sql.startsWith("INSERT OR REPLACE INTO published_projections")) {
        return { bind() { return { async run() { return { meta: { changes: 0 } }; } }; } };
      }
      if (sql.includes("fbis_sport_shard_meta")) {
        return { bind(...args) { return { async run() { sportStore.meta.set(args[0], args[1]); return { meta: { changes: 1 } }; } }; } };
      }
      if (sql.includes("nhl_parity_receipts")) {
        return { bind(...args) { return { async run() { sportStore.parity.push(args); return { meta: { changes: 1 } }; } }; } };
      }
      if (sql.includes("FROM games")) {
        return { bind() { return { async first() { return { n: sportStore.games.size }; } }; } };
      }
      if (sql.includes("FROM prediction_snapshots")) {
        return { bind() { return { async first() { return { n: sportStore.prediction_snapshots.size }; } }; } };
      }
      if (sql.includes("FROM published_projections")) {
        return { bind() { return { async first() { return { n: 0 }; } }; } };
      }
      return { bind() { return { async first() { return { n: 0 }; }, async run() { return { meta: { changes: 0 } }; } }; } };
    },
  };
  const copied = await copyNhlPilotTables({ DB: primary, NHL_DB: nhl });
  assert.equal(copied.ok, true);
  assert.equal(sportStore.games.size, 1);
  const parity = await verifyNhlSportDbParity({ DB: primary, NHL_DB: nhl });
  assert.equal(parity.ok, true);
  assert.equal(parity.status, "PARITY_OK");
});
