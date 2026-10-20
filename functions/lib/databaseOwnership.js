/**
 * Canonical FBIS D1 ownership registry.
 * Prevents new high-volume operational / historical growth from landing on primary.
 * Topology v2 (CORE + per-sport + partitioned market history) lives in databaseTopology.js;
 * this module remains the capacity / ops ownership contract consumed by existing monitors.
 */

export const D1_HARD_LIMIT_BYTES = 10_000_000_000;

export const CAPACITY_ALERT_THRESHOLDS = Object.freeze([
  { percent: 80, level: "WATCH" },
  { percent: 85, level: "HIGH" },
  { percent: 90, level: "CRITICAL" },
]);

export const DATABASE_OWNERS = Object.freeze({
  PRIMARY: Object.freeze({
    key: "PRIMARY",
    binding: "DB",
    databaseName: "fbis",
    databaseId: "b50c724c-903b-4241-8ce1-48d931e7a44c",
    role: "live_product_authority",
    accepts: Object.freeze([
      "live_cards",
      "current_market_quotes",
      "model_inputs",
      "settlement_clv_decision_links",
      "canonical_identities",
      "published_projections",
    ]),
    rejects: Object.freeze([
      "ops_telemetry_growth",
      "unbounded_historical_market_ticks",
      "raw_historic_roster_dumps",
      "cold_archives",
      "capacity_measurements",
      "retention_gates",
      "pipeline_validation_receipts",
      "query_performance_findings",
    ]),
  }),
  OPERATIONS: Object.freeze({
    key: "OPERATIONS",
    binding: "OPERATIONS_DB",
    databaseName: "fbis-operations-20261017",
    databaseId: "2371df3a-17bf-44d6-abf0-d275cf2f331e",
    role: "operational_control_plane",
    accepts: Object.freeze([
      "ops_control_plane",
      "capacity_measurements",
      "retention_gates",
      "pipeline_validation_receipts",
      "query_performance_findings",
      "job_run_telemetry_preferred",
    ]),
    rejects: Object.freeze([
      "betting_qualification_authority",
      "live_market_source_of_truth",
      "cold_historical_source_copies",
    ]),
  }),
  MARKET_HISTORY: Object.freeze({
    key: "MARKET_HISTORY",
    binding: "MARKET_HISTORY_DB",
    databaseName: "fbis-market-history",
    databaseId: "c32ccf06-c896-4d24-bb89-3e87a7412899",
    role: "market_observation_shadow_recovery",
    accepts: Object.freeze([
      "normalized_market_observation_shadow",
      "market_history_transfer_evidence",
      "primary_over_limit_recovery_writes",
    ]),
    rejects: Object.freeze([
      "decision_links",
      "clv_settlement",
      "live_card_reads_until_cutover",
      "unbounded_ws_ticks_without_retention",
    ]),
  }),
  MARKET_HISTORY_2026Q4: Object.freeze({
    key: "MARKET_HISTORY_2026Q4",
    binding: "MARKET_HISTORY_2026Q4_DB",
    databaseName: "fbis-market-history-2026q4",
    databaseId: "e8b0b65d-90a6-4842-8ee7-0f85d75afb4c",
    role: "active_market_history_partition",
    accepts: Object.freeze([
      "normalized_market_observation_hot_window",
      "primary_over_limit_recovery_writes",
      "ws_tick_hot_window",
    ]),
    rejects: Object.freeze([
      "decision_links",
      "clv_settlement",
      "indefinite_tick_retention",
    ]),
  }),
  CORE: Object.freeze({
    key: "CORE",
    binding: "CORE_DB",
    databaseName: "fbis-core",
    databaseId: "a5b438fa-eb16-4f03-95d7-1fc58ac72f04",
    role: "shared_identity_and_dashboard_core",
    accepts: Object.freeze([
      "shared_settings",
      "model_registry",
      "executed_bet_index",
      "dashboard_summaries",
    ]),
    rejects: Object.freeze([
      "sport_working_sets",
      "unbounded_market_ticks",
      "ops_telemetry_growth",
    ]),
  }),
  NHL: Object.freeze({
    key: "NHL",
    binding: "NHL_DB",
    databaseName: "fbis-nhl",
    databaseId: "a0aa010c-40d3-4d2f-8109-eca4e74e2a73",
    role: "nhl_sport_working_set_pilot",
    accepts: Object.freeze([
      "nhl_schedules",
      "nhl_projections",
      "nhl_research_decisions",
      "nhl_settlements",
      "nhl_calibration_clv",
    ]),
    rejects: Object.freeze([
      "unbounded_ws_ticks",
      "cross_sport_authority",
      "ops_telemetry",
    ]),
  }),
  COLD_HISTORY: Object.freeze({
    key: "COLD_HISTORY",
    binding: "COLD_HISTORY_DB",
    databaseName: "fbis-cold-history-20261017",
    databaseId: "6fad1baf-126f-4ab8-9b80-a7d71637d6d4",
    role: "verified_offline_historical_copy",
    accepts: Object.freeze([
      "frozen_cohort_copies",
      "verified_r2_restore_targets",
      "qualified_research_market_reads",
    ]),
    rejects: Object.freeze([
      "live_current_quote_authority",
      "qualification",
      "ops_telemetry",
    ]),
  }),
});

/** Tables whose new writes belong on OPERATIONS_DB when bound. */
export const OPERATIONS_OWNED_TABLES = Object.freeze([
  "fbis_ops_components",
  "fbis_ops_health",
  "fbis_run_manifests",
  "fbis_ops_invariant_checks",
  "fbis_watchdog_metrics",
  "fbis_capacity_measurements",
  "fbis_retention_release_gates",
  "fbis_pipeline_validation_runs",
  "fbis_d1_performance_findings",
  // Continuous-learning governance is advisory telemetry — keep it off primary.
  "learning_monitor_runs",
  "recalibration_runs",
  "challenger_evaluations",
  "bayesian_learning_state",
  "online_learning_shadow",
  "model_promotion_decisions",
  "continuous_learning_meta",
]);

/** High-volume tables that must not accumulate new historical volume on primary. */
export const PRIMARY_HIGH_VOLUME_GROWTH_TABLES = Object.freeze([
  "normalized_market_observations",
  "cfb_roster_observations",
  "mlb_market_projections",
  "action_book_observations",
]);

export function capacityAlertLevel(usedBytes, hardLimitBytes = D1_HARD_LIMIT_BYTES) {
  if (!Number.isSafeInteger(usedBytes) || usedBytes < 0) throw Error("CAPACITY_BYTES_UNAVAILABLE");
  if (!Number.isSafeInteger(hardLimitBytes) || hardLimitBytes <= 0) throw Error("CAPACITY_LIMIT_INVALID");
  const percentUsed = Number(((usedBytes / hardLimitBytes) * 100).toFixed(3));
  let level = "OK";
  for (const threshold of CAPACITY_ALERT_THRESHOLDS) {
    if (percentUsed >= threshold.percent) level = threshold.level;
  }
  if (usedBytes >= hardLimitBytes) level = "OVER_LIMIT";
  return {
    usedBytes,
    hardLimitBytes,
    remainingBytes: Math.max(0, hardLimitBytes - usedBytes),
    percentUsed,
    level,
    alerts: CAPACITY_ALERT_THRESHOLDS.map((t) => ({
      percent: t.percent,
      level: t.level,
      triggered: percentUsed >= t.percent,
    })),
  };
}

export function ownerForTable(tableName) {
  const name = String(tableName || "").trim();
  if (!name) return null;
  if (OPERATIONS_OWNED_TABLES.includes(name)) return DATABASE_OWNERS.OPERATIONS;
  if (name === "normalized_market_observations" || name === "market_history_transfer_evidence") {
    return DATABASE_OWNERS.MARKET_HISTORY;
  }
  if (name.startsWith("cold_") || name.endsWith("_cold_archive")) return DATABASE_OWNERS.COLD_HISTORY;
  return DATABASE_OWNERS.PRIMARY;
}

/**
 * Prefer OPERATIONS_DB for operational workloads; fall back to primary only when unbound.
 * Never invent a binding. Synchronous: does not prove schema readiness.
 */
export function resolveOperationsDb(env) {
  if (env?.OPERATIONS_DB?.prepare) {
    return { db: env.OPERATIONS_DB, owner: DATABASE_OWNERS.OPERATIONS, preferred: true };
  }
  if (env?.DB?.prepare) {
    return { db: env.DB, owner: DATABASE_OWNERS.PRIMARY, preferred: false };
  }
  return { db: null, owner: null, preferred: false };
}

const OPS_SCHEMA_PROBE =
  "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='fbis_ops_health' LIMIT 1";

/**
 * Prefer OPERATIONS_DB only when the operations shard schema is present.
 * If the binding exists but sql/shards/operations-v1.sql has not been applied yet,
 * fall back to primary so control-plane writers do not fail closed in production.
 */
export async function resolveReadyOperationsDb(env) {
  if (env?.OPERATIONS_DB?.prepare) {
    try {
      const row = await env.OPERATIONS_DB.prepare(OPS_SCHEMA_PROBE).first();
      if (row?.ok === 1 || row?.ok === true || Number(row?.ok) === 1) {
        return {
          db: env.OPERATIONS_DB,
          owner: DATABASE_OWNERS.OPERATIONS,
          preferred: true,
          schemaReady: true,
        };
      }
    } catch {
      // Binding present but probe failed — treat as schema unavailable.
    }
    if (env?.DB?.prepare) {
      return {
        db: env.DB,
        owner: DATABASE_OWNERS.PRIMARY,
        preferred: false,
        schemaReady: false,
        warning: "OPERATIONS_SCHEMA_UNAVAILABLE",
      };
    }
    return {
      db: null,
      owner: DATABASE_OWNERS.OPERATIONS,
      preferred: true,
      schemaReady: false,
      warning: "OPERATIONS_SCHEMA_UNAVAILABLE",
    };
  }
  return {
    ...resolveOperationsDb(env),
    schemaReady: false,
    warning: env?.DB?.prepare ? "OPERATIONS_DB_UNBOUND" : "D1_UNBOUND",
  };
}

/**
 * Reject routing that would park new ops / capacity / validation volume on primary
 * when OPERATIONS_DB is available.
 */
export function assertOperationalWriteTarget(env, tableName) {
  const owner = ownerForTable(tableName);
  if (owner?.key !== "OPERATIONS") {
    return { ok: true, owner, redirected: false };
  }
  const resolved = resolveOperationsDb(env);
  if (!resolved.db) return { ok: false, reason: "OPERATIONS_DB_UNBOUND", owner, redirected: false };
  if (resolved.preferred) return { ok: true, owner, redirected: true, binding: "OPERATIONS_DB" };
  return {
    ok: true,
    owner,
    redirected: false,
    binding: "DB",
    warning: "OPERATIONS_DB_MISSING_FALLBACK_PRIMARY",
  };
}

/**
 * Soft guard for high-volume primary growth. Callers should prefer history/cold paths.
 */
export function primaryGrowthAllowed(tableName, { snapshotType, season, forcePrimary = false } = {}) {
  if (forcePrimary) return { allowed: true, reason: "explicit_force_primary" };
  const name = String(tableName || "");
  if (!PRIMARY_HIGH_VOLUME_GROWTH_TABLES.includes(name)) {
    return { allowed: true, reason: "not_high_volume_growth_table" };
  }
  if (name === "normalized_market_observations") {
    const snap = String(snapshotType || "").toUpperCase();
    if (snap === "RESEARCH" || snap === "HISTORICAL") {
      return {
        allowed: false,
        reason: "HISTORICAL_MARKET_BELONGS_ON_MARKET_HISTORY_OR_COLD",
        preferredOwner: DATABASE_OWNERS.MARKET_HISTORY.key,
      };
    }
    return { allowed: true, reason: "current_market_quote_on_primary" };
  }
  if (name === "cfb_roster_observations") {
    const year = Number(season);
    if (Number.isFinite(year) && year <= 2025) {
      return {
        allowed: false,
        reason: "HISTORIC_RAW_ROSTER_BELONGS_ON_COLD_HISTORY",
        preferredOwner: DATABASE_OWNERS.COLD_HISTORY.key,
      };
    }
  }
  return { allowed: true, reason: "default_primary_with_capacity_review" };
}

export function ownershipManifest() {
  return {
    contract: "fbis-database-ownership-v2",
    hardLimitBytes: D1_HARD_LIMIT_BYTES,
    capacityAlertThresholds: CAPACITY_ALERT_THRESHOLDS,
    databases: Object.values(DATABASE_OWNERS),
    operationsOwnedTables: OPERATIONS_OWNED_TABLES,
    primaryHighVolumeGrowthTables: PRIMARY_HIGH_VOLUME_GROWTH_TABLES,
    topology: "see databaseTopology.js /docs/database-topology-v2.md",
  };
}
