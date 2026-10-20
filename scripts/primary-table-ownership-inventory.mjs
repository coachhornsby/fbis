#!/usr/bin/env node
/**
 * Build a machine-readable PRIMARY table-ownership manifest for sport D1 migration.
 * Classifies tables by name + known contracts. Optional --counts-json merges live row counts.
 * Does not delete or migrate anything.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { SPORT_DATABASES, CORE_DATABASE, FBIS_SPORTS } from "../functions/lib/databaseTopology.js";
import { DATABASE_OWNERS } from "../functions/lib/databaseOwnership.js";

const SPORT_PREFIX = Object.fromEntries(
  FBIS_SPORTS.flatMap((s) => [[`${s}_`, s], [s === "cfb" ? "cfbd_" : null, "cfb"]].filter((x) => x[0])),
);

const SHARED_CORE = new Set([
  "canonical_feature_registry", "canonical_governance_meta", "canonical_model_registry",
  "canonical_probability_provenance", "canonical_promotion_evidence", "canonical_provider_health",
  "canonical_publication_ledger", "canonical_runtime_version", "canonical_source_registry",
  "canonical_dq_findings", "canonical_misprice_snapshots", "model_versions",
  "model_promotion_decisions", "model_validation_runs", "model_learning_findings",
]);

const OPERATIONS = new Set([
  "job_runs", "pipeline_stage_runs", "harvest_retry_queue", "api_usage", "daily_metrics",
  "daily_reports", "fbis_ops_components", "fbis_ops_health", "fbis_ops_invariant_checks",
  "fbis_watchdog_metrics", "fbis_run_manifests", "learning_monitor_runs", "recalibration_runs",
  "d1_migrations", "schema_migrations", "store_meta", "write_conflicts",
]);

const MARKET = new Set([
  "normalized_market_observations", "normalized_market_decision_links",
  "normalized_market_economic_grades", "odds_snapshots", "source_observations",
  "shadow_market_observations", "shadow_market_books", "shadow_market_splits",
  "shadow_line_movement", "shadow_observation_keys",
]);

const LEDGER = new Set([
  "executed_bets", "executed_bet_audit", "strategies", "strategy_tickets",
  "strategy_qualification_attempts", "strategy_settlement_corrections",
  "strategy_ticket_probability_corrections",
]);

const WORKING_SHARED = new Set([
  "games", "prediction_snapshots", "published_projections", "predictions",
  "prediction_layers", "team_feature_snapshots", "team_form", "team_form_games",
  "player_availability_observations",
]);

/** Player Props surfaces — owned by a separate workstream; do not migrate here. */
const PLAYER_PROPS = new Set([
  "player_prop_cards", "player_prop_legs", "prizepicks_daily_acquisitions",
  "prizepicks_prop_lines", "prizepicks_prop_observations",
]);

function classify(table) {
  const name = String(table || "");
  if (PLAYER_PROPS.has(name) || /_prop_/i.test(name) && /player|prizepicks/i.test(name)) {
    return {
      associatedSport: null,
      destinationD1: "DEFER_PLAYER_PROPS_WORKSTREAM",
      sourceOfTruth: "PRIMARY_UNTIL_PROPS_OWNER_CUTOVER",
      retentionPolicy: "retain_primary_no_sport_migration_this_track",
    };
  }
  if (SHARED_CORE.has(name)) {
    return {
      associatedSport: null,
      destinationD1: CORE_DATABASE.databaseName,
      sourceOfTruth: "PRIMARY_UNTIL_CORE_CUTOVER",
      retentionPolicy: "copy_then_retain_until_core_receipt",
    };
  }
  if (OPERATIONS.has(name) || name.startsWith("fbis_ops") || name.startsWith("shadow_collection")
    || name.startsWith("shadow_provider") || name.startsWith("shadow_cost")
    || name.startsWith("external_acquisition") || name.startsWith("apify_")) {
    return {
      associatedSport: null,
      destinationD1: DATABASE_OWNERS.OPERATIONS.databaseName,
      sourceOfTruth: "OPERATIONS_PREFERRED",
      retentionPolicy: "ops_owned_prefer_operations_db",
    };
  }
  if (MARKET.has(name) || name.startsWith("action_market")) {
    return {
      associatedSport: null,
      destinationD1: "fbis-market-history-2026q4 + R2",
      sourceOfTruth: "MARKET_HISTORY_PARTITIONS",
      retentionPolicy: "hot_window_d1_then_r2_archive",
    };
  }
  if (LEDGER.has(name) || name.startsWith("polymarket_us_private")) {
    return {
      associatedSport: null,
      destinationD1: "PRIMARY_LEDGER_AUTHORITY",
      sourceOfTruth: "PRIMARY_WAGER_ACCOUNT_LEDGER",
      retentionPolicy: "do_not_move_without_accounting_design",
    };
  }
  for (const [prefix, sport] of Object.entries(SPORT_PREFIX)) {
    if (name.startsWith(prefix) || name.startsWith(`asian_baseball_`) && (sport === "npb" || sport === "kbo")) {
      const dest = SPORT_DATABASES[sport];
      return {
        associatedSport: sport,
        destinationD1: dest?.databaseName || `fbis-${sport}`,
        sourceOfTruth: "PRIMARY_UNTIL_SPORT_CUTOVER",
        retentionPolicy: "shadow_copy_reconcile_then_retire_after_authorization",
      };
    }
  }
  // asian baseball → NPB/KBO research
  if (name.startsWith("asian_baseball_")) {
    return {
      associatedSport: "npb+kbo",
      destinationD1: "fbis-npb / fbis-kbo (split by league)",
      sourceOfTruth: "PRIMARY_UNTIL_SPORT_CUTOVER",
      retentionPolicy: "inspect_league_before_copy",
    };
  }
  if (WORKING_SHARED.has(name)) {
    return {
      associatedSport: "per_row_sport",
      destinationD1: "per_sport_d1_via_sport_column",
      sourceOfTruth: "PRIMARY_UNTIL_SPORT_CUTOVER",
      retentionPolicy: "paged_copy_by_sport_preserve_ids",
    };
  }
  return {
    associatedSport: null,
    destinationD1: "PRIMARY_REVIEW_REQUIRED",
    sourceOfTruth: "PRIMARY",
    retentionPolicy: "inspect_dependencies_before_move",
  };
}

function loadTables() {
  const arg = process.argv.find((a) => a.startsWith("--tables-json="));
  if (arg) return JSON.parse(readFileSync(arg.slice("--tables-json=".length), "utf8"));
  const defaultPath = "/opt/cursor/artifacts/sport-d1-capacity/primary-table-names.json";
  if (existsSync(defaultPath)) return JSON.parse(readFileSync(defaultPath, "utf8"));
  throw new Error("Pass --tables-json=path or place primary-table-names.json in artifacts");
}

function loadCounts() {
  const arg = process.argv.find((a) => a.startsWith("--counts-json="));
  if (!arg) return {};
  const rows = JSON.parse(readFileSync(arg.slice("--counts-json=".length), "utf8"));
  const map = {};
  for (const r of rows) map[r.table] = r;
  return map;
}

const tables = loadTables();
const counts = loadCounts();
const manifest = {
  contract: "fbis-primary-table-ownership-v1",
  generatedAt: new Date().toISOString(),
  primaryDatabase: DATABASE_OWNERS.PRIMARY,
  primaryBytesMeasured: 8_113_790_976,
  tableCount: tables.length,
  canAuthorizeWager: false,
  notes: [
    "Row counts and storage bytes are estimates unless counts-json supplies live COUNT(*).",
    "Cloudflare D1 does not expose per-table file_size; storageContributionBytes is estimated when avgRowBytes present.",
    "Player Props tables are explicitly deferred to the Props workstream.",
    "No source retirement is authorized by this inventory alone.",
  ],
  tables: tables.map((name) => {
    const c = classify(name);
    const counted = counts[name];
    const rows = counted?.rows ?? null;
    const avgRowBytes = counted?.avgRowBytes ?? null;
    return {
      table: name,
      rowCount: rows,
      storageContributionBytes: rows != null && avgRowBytes != null ? rows * avgRowBytes : null,
      storageContributionEstimated: rows != null && avgRowBytes != null,
      indexes: counted?.indexes || null,
      readConsumers: counted?.readConsumers || null,
      writeProducers: counted?.writeProducers || null,
      associatedSport: c.associatedSport,
      sourceOfTruth: c.sourceOfTruth,
      destinationD1: c.destinationD1,
      retentionPolicy: c.retentionPolicy,
      dependencies: counted?.dependencies || null,
      rollbackBehavior: "restore_from_primary_or_r2_manifest_before_delete",
    };
  }),
};

const outArg = process.argv.find((a) => a.startsWith("--out="));
const out = outArg ? outArg.slice("--out=".length) : "/opt/cursor/artifacts/sport-d1-capacity/primary-table-ownership-manifest.json";
writeFileSync(out, JSON.stringify(manifest, null, 2));
const byDest = {};
for (const t of manifest.tables) {
  byDest[t.destinationD1] = (byDest[t.destinationD1] || 0) + 1;
}
console.log(JSON.stringify({
  ok: true,
  out,
  tableCount: manifest.tableCount,
  byDestination: byDest,
  canAuthorizeWager: false,
}, null, 2));
