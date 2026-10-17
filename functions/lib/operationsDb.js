/**
 * Operations D1 write helper with schema-ready preference and primary fallback.
 * Completes the sustainable-ops cutover safety net:
 * 1) Prefer OPERATIONS_DB when fbis_ops_health exists
 * 2) Fall back to primary when unbound or schema missing
 * 3) Retry on primary if an ops write still fails with no-such-table
 */

import { resolveReadyOperationsDb, DATABASE_OWNERS } from "./databaseOwnership.js";

const NO_TABLE = /no such table|SQLITE_ERROR.*table/i;

/** Isolate-local cache so hot job paths do not probe sqlite_master every write. */
let schemaCache = { ready: null, checkedAt: 0 };
const SCHEMA_CACHE_MS = 60_000;

export function clearOperationsSchemaCache() {
  schemaCache = { ready: null, checkedAt: 0 };
}

export async function resolveOperationsWriteTarget(env, { bypassCache = false } = {}) {
  const now = Date.now();
  if (
    !bypassCache &&
    schemaCache.ready === true &&
    env?.OPERATIONS_DB?.prepare &&
    now - schemaCache.checkedAt < SCHEMA_CACHE_MS
  ) {
    return {
      db: env.OPERATIONS_DB,
      owner: DATABASE_OWNERS.OPERATIONS,
      preferred: true,
      schemaReady: true,
      cached: true,
    };
  }

  const resolved = await resolveReadyOperationsDb(env);
  schemaCache = {
    ready: resolved.schemaReady === true,
    checkedAt: now,
  };
  return { ...resolved, cached: false };
}

/**
 * Run an async writer against the preferred ops DB, falling back to primary
 * when the operations schema is unavailable or the write hits no-such-table.
 */
export async function withOperationsWrite(env, writer) {
  const target = await resolveOperationsWriteTarget(env);
  if (!target.db?.prepare) {
    return { ok: false, reason: "d1-unbound", binding: null, preferred: false };
  }

  try {
    const result = await writer(target.db, target);
    return {
      ok: result?.ok !== false,
      ...result,
      binding: target.preferred ? "OPERATIONS_DB" : "DB",
      preferred: target.preferred,
      schemaReady: target.schemaReady === true,
      warning: target.warning || null,
    };
  } catch (err) {
    const message = String(err?.message || err);
    if (target.preferred && NO_TABLE.test(message) && env?.DB?.prepare) {
      clearOperationsSchemaCache();
      const result = await writer(env.DB, {
        ...target,
        db: env.DB,
        preferred: false,
        schemaReady: false,
        warning: "OPERATIONS_SCHEMA_UNAVAILABLE_WRITE_FALLBACK",
      });
      return {
        ok: result?.ok !== false,
        ...result,
        binding: "DB",
        preferred: false,
        schemaReady: false,
        warning: "OPERATIONS_SCHEMA_UNAVAILABLE_WRITE_FALLBACK",
        fallbackFrom: "OPERATIONS_DB",
        fallbackError: message.slice(0, 200),
      };
    }
    throw err;
  }
}

/**
 * Compare control-plane row presence on OPERATIONS_DB vs primary for operator verification.
 */
export async function verifyOperationsRouting(env) {
  const probes = [
    ["fbis_ops_health", "SELECT COUNT(*) AS n, MAX(updated_at) AS last_at FROM fbis_ops_health"],
    ["fbis_run_manifests", "SELECT COUNT(*) AS n, MAX(COALESCE(finished_at, started_at, created_at)) AS last_at FROM fbis_run_manifests"],
    ["fbis_watchdog_metrics", "SELECT COUNT(*) AS n, MAX(detected_at) AS last_at FROM fbis_watchdog_metrics"],
    ["fbis_capacity_measurements", "SELECT COUNT(*) AS n, MAX(measured_at) AS last_at FROM fbis_capacity_measurements"],
    ["fbis_pipeline_validation_runs", "SELECT COUNT(*) AS n, MAX(validated_at) AS last_at FROM fbis_pipeline_validation_runs"],
    ["fbis_d1_performance_findings", "SELECT COUNT(*) AS n, MAX(recorded_at) AS last_at FROM fbis_d1_performance_findings"],
    ["fbis_retention_release_gates", "SELECT COUNT(*) AS n, MAX(updated_at) AS last_at FROM fbis_retention_release_gates"],
  ];
  const probe = async (db, label) => {
    if (!db?.prepare) return { bound: false, label, tables: {} };
    const tables = {};
    for (const [table, sql] of probes) {
      try {
        const row = await db.prepare(sql).first();
        tables[table] = {
          present: true,
          rows: Number(row?.n || 0),
          lastAt: row?.last_at || null,
        };
      } catch (err) {
        const msg = String(err?.message || err);
        tables[table] = {
          present: false,
          rows: 0,
          lastAt: null,
          error: NO_TABLE.test(msg) ? "NO_SUCH_TABLE" : msg.slice(0, 120),
        };
      }
    }
    return { bound: true, label, tables };
  };

  const target = await resolveOperationsWriteTarget(env, { bypassCache: true });
  const [operations, primary] = await Promise.all([
    probe(env?.OPERATIONS_DB, "OPERATIONS_DB"),
    probe(env?.DB, "DB"),
  ]);

  const opsHealth = operations.tables.fbis_ops_health;
  const primaryHealth = primary.tables.fbis_ops_health;
  const routing =
    target.preferred && opsHealth?.present
      ? opsHealth.rows > 0
        ? "OPERATIONS_DB_ACTIVE"
        : "OPERATIONS_DB_READY_AWAITING_WRITES"
      : opsHealth?.present === false || target.warning
        ? "PRIMARY_FALLBACK"
        : "UNKNOWN";

  return {
    contract: "fbis-operations-routing-verify-v1",
    checkedAt: new Date().toISOString(),
    writeTarget: {
      binding: target.preferred ? "OPERATIONS_DB" : "DB",
      preferred: target.preferred === true,
      schemaReady: target.schemaReady === true,
      warning: target.warning || null,
    },
    routing,
    operations,
    primary,
    ok: routing === "OPERATIONS_DB_ACTIVE" || routing === "OPERATIONS_DB_READY_AWAITING_WRITES" || routing === "PRIMARY_FALLBACK",
  };
}
