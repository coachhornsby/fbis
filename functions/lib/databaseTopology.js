/**
 * FBIS multi-D1 topology v2.
 * CORE + OPERATIONS + per-sport working DBs + partitioned market history + R2 archives.
 * Sport isolation does not authorize unbounded WebSocket tick retention in any D1.
 */
import { DATABASE_OWNERS, D1_HARD_LIMIT_BYTES, capacityAlertLevel } from "./databaseOwnership.js";

export const TOPOLOGY_CONTRACT = "fbis-database-topology-v2";

/** Working window for searchable market observations in D1. Older ticks → R2. */
export const MARKET_HISTORY_HOT_WINDOW_MS = 7 * 24 * 3600 * 1000;

export const FBIS_SPORTS = Object.freeze([
  "nfl", "cfb", "cbb", "nba", "wnba", "mlb", "nhl", "soccer", "tennis", "npb", "kbo",
]);

/**
 * Planned sport working databases. Only NHL is provisioned in this release (pilot).
 * Other sports remain on PRIMARY until their D1 is created and parity-verified.
 */
export const SPORT_DATABASES = Object.freeze({
  nhl: Object.freeze({
    sport: "nhl",
    binding: "NHL_DB",
    databaseName: "fbis-nhl",
    databaseId: "a0aa010c-40d3-4d2f-8109-eca4e74e2a73",
    pilotStatus: "SCHEMA_READY",
    accepts: Object.freeze([
      "schedules", "teams", "players", "stats", "projections",
      "research_decisions", "settlements", "calibration", "clv_links",
    ]),
    rejects: Object.freeze([
      "unbounded_ws_ticks", "cross_sport_joins", "ops_telemetry", "raw_provider_blobs",
    ]),
  }),
  nfl: Object.freeze({ sport: "nfl", binding: "NFL_DB", databaseName: "fbis-nfl", databaseId: null, pilotStatus: "PLANNED" }),
  cfb: Object.freeze({ sport: "cfb", binding: "CFB_DB", databaseName: "fbis-cfb", databaseId: null, pilotStatus: "PLANNED" }),
  cbb: Object.freeze({ sport: "cbb", binding: "CBB_DB", databaseName: "fbis-cbb", databaseId: null, pilotStatus: "PLANNED" }),
  nba: Object.freeze({ sport: "nba", binding: "NBA_DB", databaseName: "fbis-nba", databaseId: null, pilotStatus: "PLANNED" }),
  wnba: Object.freeze({ sport: "wnba", binding: "WNBA_DB", databaseName: "fbis-wnba", databaseId: null, pilotStatus: "PLANNED" }),
  mlb: Object.freeze({ sport: "mlb", binding: "MLB_DB", databaseName: "fbis-mlb", databaseId: null, pilotStatus: "PLANNED" }),
  soccer: Object.freeze({ sport: "soccer", binding: "SOCCER_DB", databaseName: "fbis-soccer", databaseId: null, pilotStatus: "PLANNED" }),
  tennis: Object.freeze({ sport: "tennis", binding: "TENNIS_DB", databaseName: "fbis-tennis", databaseId: null, pilotStatus: "PLANNED" }),
  npb: Object.freeze({ sport: "npb", binding: "NPB_DB", databaseName: "fbis-npb", databaseId: null, pilotStatus: "PLANNED" }),
  kbo: Object.freeze({ sport: "kbo", binding: "KBO_DB", databaseName: "fbis-kbo", databaseId: null, pilotStatus: "PLANNED" }),
});

export const CORE_DATABASE = Object.freeze({
  key: "CORE",
  binding: "CORE_DB",
  databaseName: "fbis-core",
  databaseId: "a5b438fa-eb16-4f03-95d7-1fc58ac72f04",
  role: "shared_identity_and_dashboard_core",
  accepts: Object.freeze([
    "shared_settings", "model_registry", "executed_bet_index",
    "dashboard_summaries", "topology_migrations",
  ]),
  rejects: Object.freeze([
    "sport_working_sets", "unbounded_market_ticks", "raw_archives",
  ]),
});

/** Ordered newest-first market history partitions. Writes prefer the first writable partition. */
export const MARKET_HISTORY_PARTITIONS = Object.freeze([
  Object.freeze({
    key: "MARKET_HISTORY_2026Q4",
    binding: "MARKET_HISTORY_2026Q4_DB",
    databaseName: "fbis-market-history-2026q4",
    databaseId: "e8b0b65d-90a6-4842-8ee7-0f85d75afb4c",
    window: Object.freeze({ start: "2026-10-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" }),
    role: "active_market_history_partition",
  }),
  Object.freeze({
    key: "MARKET_HISTORY",
    binding: "MARKET_HISTORY_DB",
    databaseName: DATABASE_OWNERS.MARKET_HISTORY.databaseName,
    databaseId: DATABASE_OWNERS.MARKET_HISTORY.databaseId,
    window: Object.freeze({ start: null, end: "2026-10-20T00:00:00.000Z" }),
    role: "legacy_market_history_shadow",
  }),
]);

export function normalizeSport(sport) {
  const s = String(sport || "").trim().toLowerCase();
  return FBIS_SPORTS.includes(s) ? s : null;
}

export function resolveCoreDb(env) {
  if (env?.CORE_DB?.prepare) {
    return { db: env.CORE_DB, owner: CORE_DATABASE, preferred: true, binding: "CORE_DB" };
  }
  if (env?.DB?.prepare) {
    return {
      db: env.DB,
      owner: DATABASE_OWNERS.PRIMARY,
      preferred: false,
      binding: "DB",
      warning: "CORE_DB_UNBOUND_FALLBACK_PRIMARY",
    };
  }
  return { db: null, owner: null, preferred: false, binding: null, warning: "D1_UNBOUND" };
}

/**
 * Resolve the working database for a sport.
 * Until a sport D1 is bound and schema-ready, reads/writes stay on PRIMARY.
 * mode: primary | shadow | sport (env NHL_SPORT_DB_MODE / SPORT_DB_MODE_<SPORT>)
 */
export function resolveSportDb(env, sport, { mode } = {}) {
  const key = normalizeSport(sport);
  if (!key) return { db: env?.DB || null, sport: null, binding: "DB", preferred: false, reason: "UNKNOWN_SPORT" };
  const plan = SPORT_DATABASES[key];
  const bindingName = plan?.binding;
  const sportDb = bindingName ? env?.[bindingName] : null;
  const effectiveMode = String(
    mode
    || env?.[`SPORT_DB_MODE_${key.toUpperCase()}`]
    || (key === "nhl" ? env?.NHL_SPORT_DB_MODE : null)
    || "primary"
  ).toLowerCase();

  if (!sportDb?.prepare || plan?.pilotStatus === "PLANNED" || !plan?.databaseId) {
    return {
      db: env?.DB || null,
      sport: key,
      plan,
      binding: "DB",
      preferred: false,
      mode: effectiveMode,
      reason: sportDb?.prepare ? "SPORT_DB_NOT_PROVISIONED" : "SPORT_DB_UNBOUND",
    };
  }

  if (effectiveMode === "sport") {
    return { db: sportDb, sport: key, plan, binding: bindingName, preferred: true, mode: effectiveMode, reason: "SPORT_DB_ACTIVE" };
  }
  if (effectiveMode === "shadow") {
    return {
      db: env?.DB || null,
      sportDb,
      sport: key,
      plan,
      binding: "DB",
      preferred: false,
      mode: effectiveMode,
      reason: "SPORT_DB_SHADOW_PRIMARY_READS",
    };
  }
  return {
    db: env?.DB || null,
    sportDb,
    sport: key,
    plan,
    binding: "DB",
    preferred: false,
    mode: effectiveMode,
    reason: "SPORT_DB_BOUND_PRIMARY_AUTHORITY",
  };
}

async function probeSize(db) {
  if (!db?.prepare) return null;
  try {
    const result = await db.prepare("SELECT 1 AS healthy").all();
    const bytes = Number(result?.meta?.size_after);
    return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
  } catch {
    return null;
  }
}

async function schemaReady(db, tableName) {
  if (!db?.prepare) return false;
  try {
    const row = await db.prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
    ).bind(tableName).first();
    return row?.ok === 1 || row?.ok === true || Number(row?.ok) === 1;
  } catch {
    return false;
  }
}

/**
 * Prefer the newest market-history partition that is bound, schema-ready, and under WATCH.
 * Legacy MARKET_HISTORY_DB remains readable; near-full partitions stop accepting new writes.
 */
export async function resolveMarketHistoryWriteDb(env, { now = new Date() } = {}) {
  const at = now instanceof Date ? now.toISOString() : String(now);
  for (const part of MARKET_HISTORY_PARTITIONS) {
    const db = env?.[part.binding];
    if (!db?.prepare) continue;
    if (!(await schemaReady(db, "normalized_market_observations"))) continue;
    if (part.window?.start && at < part.window.start) continue;
    if (part.window?.end && at >= part.window.end && part.key !== "MARKET_HISTORY_2026Q4") continue;
    const bytes = await probeSize(db);
    if (bytes != null) {
      const capacity = capacityAlertLevel(bytes);
      if (capacity.level === "CRITICAL" || capacity.level === "OVER_LIMIT") continue;
    }
    return {
      db,
      partition: part,
      binding: part.binding,
      store: part.key,
      capacity: bytes == null ? null : capacityAlertLevel(bytes),
    };
  }
  if (env?.MARKET_HISTORY_DB?.prepare) {
    return {
      db: env.MARKET_HISTORY_DB,
      partition: MARKET_HISTORY_PARTITIONS.find((p) => p.binding === "MARKET_HISTORY_DB"),
      binding: "MARKET_HISTORY_DB",
      store: "MARKET_HISTORY",
      warning: "ALL_PARTITIONS_FULL_OR_UNREADY_FALLBACK_LEGACY",
    };
  }
  return { db: null, partition: null, binding: null, store: null, warning: "MARKET_HISTORY_UNBOUND" };
}

/** All bound market-history databases for merged reads (newest first). */
export function listMarketHistoryReadDbs(env) {
  const out = [];
  for (const part of MARKET_HISTORY_PARTITIONS) {
    const db = env?.[part.binding];
    if (db?.prepare) out.push({ db, partition: part, binding: part.binding });
  }
  return out;
}

export function marketHistoryHotCutoff(now = new Date()) {
  return new Date(now.getTime() - MARKET_HISTORY_HOT_WINDOW_MS).toISOString();
}

/**
 * Retention rule: D1 holds only the hot window; older observations belong in R2 archives.
 * Does not delete — returns the policy decision for operators / archive jobs.
 */
export function marketHistoryRetentionDecision({ collectedAt, now = new Date() } = {}) {
  const collected = Date.parse(collectedAt);
  if (!Number.isFinite(collected)) {
    return { retainInD1: false, reason: "COLLECTED_AT_UNVERIFIED", action: "REQUIRE_CLOCK" };
  }
  const cutoff = now.getTime() - MARKET_HISTORY_HOT_WINDOW_MS;
  if (collected >= cutoff) {
    return {
      retainInD1: true,
      reason: "WITHIN_HOT_WINDOW",
      action: "KEEP_SEARCHABLE",
      hotCutoff: new Date(cutoff).toISOString(),
    };
  }
  return {
    retainInD1: false,
    reason: "OLDER_THAN_HOT_WINDOW",
    action: "ARCHIVE_TO_R2_THEN_RETENTION_GATE",
    hotCutoff: new Date(cutoff).toISOString(),
  };
}

export function topologyManifest() {
  return {
    contract: TOPOLOGY_CONTRACT,
    hardLimitBytes: D1_HARD_LIMIT_BYTES,
    core: CORE_DATABASE,
    operations: DATABASE_OWNERS.OPERATIONS,
    primary: DATABASE_OWNERS.PRIMARY,
    coldHistory: DATABASE_OWNERS.COLD_HISTORY,
    sports: Object.values(SPORT_DATABASES),
    marketHistoryPartitions: MARKET_HISTORY_PARTITIONS,
    marketHistoryHotWindowMs: MARKET_HISTORY_HOT_WINDOW_MS,
    r2: {
      binding: "ARCHIVE",
      role: "raw_provider_responses_historical_archives_model_artifacts_recovery",
    },
    migrationPhases: Object.freeze([
      "inventory_table_sizes_readers_writers",
      "reuse_operations_db",
      "pilot_nhl_copy_and_read_parity",
      "migrate_highest_growth_sports",
      "retire_old_copies_after_recovery_checks",
    ]),
  };
}

export async function probeTopologyCapacity(env) {
  const live = {};
  const targets = [
    ["PRIMARY", env?.DB, DATABASE_OWNERS.PRIMARY.databaseId],
    ["OPERATIONS", env?.OPERATIONS_DB, DATABASE_OWNERS.OPERATIONS.databaseId],
    ["CORE", env?.CORE_DB, CORE_DATABASE.databaseId],
    ["NHL", env?.NHL_DB, SPORT_DATABASES.nhl.databaseId],
    ["MARKET_HISTORY", env?.MARKET_HISTORY_DB, DATABASE_OWNERS.MARKET_HISTORY.databaseId],
    ["MARKET_HISTORY_2026Q4", env?.MARKET_HISTORY_2026Q4_DB, MARKET_HISTORY_PARTITIONS[0].databaseId],
    ["COLD_HISTORY", env?.COLD_HISTORY_DB, DATABASE_OWNERS.COLD_HISTORY.databaseId],
    ["TIER3", env?.TIER3_DB, null],
  ];
  for (const [key, db, databaseId] of targets) {
    if (!db?.prepare) {
      live[key] = { bound: false, databaseId };
      continue;
    }
    const bytes = await probeSize(db);
    live[key] = bytes == null
      ? { bound: true, databaseId, sizeUnavailable: true }
      : { bound: true, databaseId, ...capacityAlertLevel(bytes) };
  }
  return live;
}
