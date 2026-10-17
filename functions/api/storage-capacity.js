import { harvestSecret } from "../lib/auth.js";
import {
  D1_HARD_LIMIT_BYTES,
  capacityAlertLevel,
  DATABASE_OWNERS,
  resolveOperationsDb,
} from "../lib/databaseOwnership.js";

/** Accurate D1 storage telemetry from the binding query metadata.
 * SQLite dbstat/page_count is not authorized on production D1.
 * Workers Paid account-wide billing is usage-based, NOT capped at 5 GB.
 * Alerts fire at 80% (WATCH), 85% (HIGH), and 90% (CRITICAL).
 */
export const D1_DATABASE_MAX_BYTES = D1_HARD_LIMIT_BYTES;

const response = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  },
});

function summarizeOne(bytes, databaseKey) {
  const alert = capacityAlertLevel(bytes, D1_DATABASE_MAX_BYTES);
  // Preserve prior coarse state labels while exposing explicit 80/85/90 alerts.
  let state = alert.level;
  if (alert.percentUsed >= 100) state = "OVER_LIMIT";
  else if (alert.percentUsed >= 99) state = "EMERGENCY";
  else if (alert.percentUsed >= 95) state = "CRITICAL";
  else if (alert.percentUsed >= 90) state = "CRITICAL";
  else if (alert.percentUsed >= 85) state = "HIGH";
  else if (alert.percentUsed >= 80) state = "WATCH";
  else state = "OK";
  return {
    databaseKey,
    usedBytes: alert.usedBytes,
    hardLimitBytes: alert.hardLimitBytes,
    remainingBytes: alert.remainingBytes,
    percentUsed: alert.percentUsed,
    state,
    alertLevel: alert.level,
    alerts: alert.alerts,
  };
}

export function summarizeD1Storage(primaryBytes, shardBytes, operationsBytes = null) {
  const safe = (n) => Number.isSafeInteger(n) && n > 0;
  if (!safe(primaryBytes) || !safe(shardBytes)) throw Error("STORAGE_SIZE_UNAVAILABLE");
  const primary = summarizeOne(primaryBytes, "PRIMARY");
  const historyShard = summarizeOne(shardBytes, "MARKET_HISTORY");
  const operations = operationsBytes == null
    ? null
    : safe(operationsBytes)
      ? summarizeOne(operationsBytes, "OPERATIONS")
      : (() => { throw Error("STORAGE_SIZE_UNAVAILABLE"); })();

  const primaryState = primaryBytes >= D1_DATABASE_MAX_BYTES
    ? "PRIMARY_OVER_LIMIT"
    : primaryBytes >= D1_DATABASE_MAX_BYTES * 0.9
      ? "PRIMARY_CRITICAL"
      : primaryBytes >= D1_DATABASE_MAX_BYTES * 0.8
        ? "PRIMARY_WATCH"
        : "PRIMARY_WITH_HEADROOM";

  return {
    state: primaryState,
    primary,
    historyShard,
    operations,
    coldHistory: {
      databaseKey: "COLD_HISTORY",
      databaseId: DATABASE_OWNERS.COLD_HISTORY.databaseId,
      databaseName: DATABASE_OWNERS.COLD_HISTORY.databaseName,
      bound: false,
      note: "Pages may bind COLD_HISTORY_DB for qualified archive reads; daily monitor always measures physical bytes.",
    },
    knownBoundD1Bytes: primaryBytes + shardBytes + (operationsBytes || 0),
    accountWideUsageMeasured: false,
    r2BillableBytesMeasured: false,
    invoiceEstimated: false,
    historicRowsDeletedByProbe: 0,
    sourceOfTruth: "PRIMARY_D1",
    operationsDbPreferred: true,
    capacityAlertThresholds: [80, 85, 90],
  };
}

async function probe(binding) {
  const result = await binding.prepare("SELECT 1 AS healthy").all();
  return Number(result?.meta?.size_after);
}

async function persistCapacitySnapshot(env, summary) {
  const { db } = resolveOperationsDb(env);
  if (!db?.prepare) return { ok: false, reason: "operations-db-unbound" };
  const measuredAt = new Date().toISOString();
  const rows = [
    ["PRIMARY", DATABASE_OWNERS.PRIMARY.databaseId, DATABASE_OWNERS.PRIMARY.databaseName, summary.primary],
    ["MARKET_HISTORY", DATABASE_OWNERS.MARKET_HISTORY.databaseId, DATABASE_OWNERS.MARKET_HISTORY.databaseName, summary.historyShard],
  ];
  if (summary.operations) {
    rows.push(["OPERATIONS", DATABASE_OWNERS.OPERATIONS.databaseId, DATABASE_OWNERS.OPERATIONS.databaseName, summary.operations]);
  }
  for (const [key, id, name, info] of rows) {
    const measurementId = `${key}:${measuredAt}`;
    await db.prepare(
      `INSERT OR REPLACE INTO fbis_capacity_measurements (
        measurement_id, measured_at, database_key, database_id, database_name,
        used_bytes, hard_limit_bytes, percent_used, alert_level,
        alert_80, alert_85, alert_90, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      measurementId,
      measuredAt,
      key,
      id,
      name,
      info.usedBytes,
      info.hardLimitBytes,
      info.percentUsed,
      info.alertLevel,
      info.percentUsed >= 80 ? 1 : 0,
      info.percentUsed >= 85 ? 1 : 0,
      info.percentUsed >= 90 ? 1 : 0,
      JSON.stringify({ state: info.state, alerts: info.alerts })
    ).run();
  }
  return { ok: true, measuredAt };
}

export async function onRequestGet({ env, request } = {}) {
  const secret = harvestSecret(env);
  const provided = request?.headers?.get("x-harvest-secret");
  if (!secret || !provided || provided !== secret) return response({ ok: false, error: "FORBIDDEN" }, 403);
  if (!env?.DB?.prepare || !env?.MARKET_HISTORY_DB?.prepare) {
    return response({ ok: false, error: "STORAGE_BINDING_UNAVAILABLE" }, 503);
  }
  try {
    const probes = [
      probe(env.DB),
      probe(env.MARKET_HISTORY_DB),
      env.OPERATIONS_DB?.prepare ? probe(env.OPERATIONS_DB) : Promise.resolve(null),
      env.COLD_HISTORY_DB?.prepare ? probe(env.COLD_HISTORY_DB) : Promise.resolve(null),
    ];
    const sizes = await Promise.all(probes);
    const result = summarizeD1Storage(sizes[0], sizes[1], sizes[2]);
    if (sizes[3] != null && Number.isSafeInteger(sizes[3]) && sizes[3] > 0) {
      result.coldHistory = {
        ...summarizeD1Storage(sizes[3], 1).primary,
        databaseKey: "COLD_HISTORY",
        databaseId: DATABASE_OWNERS.COLD_HISTORY.databaseId,
        databaseName: DATABASE_OWNERS.COLD_HISTORY.databaseName,
        bound: true,
      };
      result.knownBoundD1Bytes += sizes[3];
    }
    let persisted = { ok: false, reason: "not-requested" };
    const url = request?.url ? new URL(request.url) : null;
    if (url?.searchParams?.get("persist") === "1") {
      try {
        persisted = await persistCapacitySnapshot(env, result);
      } catch (err) {
        persisted = { ok: false, reason: String(err?.message || err) };
      }
    }
    return response({ ok: true, ...result, persist: persisted });
  } catch {
    return response({ ok: false, error: "STORAGE_METADATA_UNAVAILABLE" }, 503);
  }
}

export async function onRequestPost() {
  return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
