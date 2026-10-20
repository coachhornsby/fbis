#!/usr/bin/env node
/**
 * Inventory D1 bindings for topology v2: sizes, owners, and next migration actions.
 * Read-only against Cloudflare when CF credentials are present; otherwise prints the contract.
 */
import { topologyManifest, MARKET_HISTORY_HOT_WINDOW_MS } from "../functions/lib/databaseTopology.js";
import { D1_HARD_LIMIT_BYTES } from "../functions/lib/databaseOwnership.js";

const manifest = topologyManifest();
const rows = [
  ["PRIMARY", manifest.primary.databaseName, manifest.primary.databaseId],
  ["OPERATIONS", manifest.operations.databaseName, manifest.operations.databaseId],
  ["CORE", manifest.core.databaseName, manifest.core.databaseId],
  ...manifest.sports.map((s) => [s.binding, s.databaseName, s.databaseId || "PLANNED"]),
  ...manifest.marketHistoryPartitions.map((p) => [p.binding, p.databaseName, p.databaseId]),
  ["COLD_HISTORY", manifest.coldHistory.databaseName, manifest.coldHistory.databaseId],
];

const report = {
  contract: manifest.contract,
  generatedAt: new Date().toISOString(),
  hardLimitBytes: D1_HARD_LIMIT_BYTES,
  marketHistoryHotWindowHours: MARKET_HISTORY_HOT_WINDOW_MS / 3600000,
  databases: rows.map(([binding, name, id]) => ({ binding, name, id })),
  migrationPhases: manifest.migrationPhases,
  nextActions: [
    "Bind all sport D1s + CORE_DB + MARKET_HISTORY_2026Q4_DB on Pages (wrangler.toml updated).",
    "NHL pilot copy/parity live: PARITY_OK — keep NHL_SPORT_DB_MODE=shadow until product cutover.",
    "Remaining sports SCHEMA_READY in shadow; run per-sport copy + parity before SPORT_DB_MODE_*=sport.",
    "Route new WS/REST recovery writes to MARKET_HISTORY_2026Q4_DB (wired).",
    "Run POST /api/database-topology operation=market-history-archive-scan (dry-run, then archiveWrites=true).",
    "Retention-gate delete only after verified R2 recovery — never auto-delete.",
  ],
  canAuthorizeWager: false,
};

console.log(JSON.stringify(report, null, 2));
