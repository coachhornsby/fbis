/**
 * Static D1 performance audit: expensive patterns, redundant indexes, dual writes.
 * Findings prefer OPERATIONS_DB persistence; this module never mutates source tables.
 */

import { createHash } from "node:crypto";
import { resolveReadyOperationsDb } from "./databaseOwnership.js";

export const PERFORMANCE_AUDIT_CONTRACT = "fbis-d1-performance-audit-v1";

/** Known expensive or redundant patterns from production recovery work. */
export const KNOWN_PERFORMANCE_FINDINGS = Object.freeze([
  {
    findingId: "perf:primary-market-research-growth",
    findingType: "high_volume_primary_write",
    severity: "HIGH",
    tableName: "normalized_market_observations",
    indexName: null,
    detail: "Historical RESEARCH market observations previously dominated primary D1 growth.",
    recommendation: "Route new RESEARCH/HISTORICAL snapshots to MARKET_HISTORY_DB; keep CURRENT quotes on primary until consumer cutover.",
    estimatedD1Impact: "Prevents multi-hundred-MB primary re-accumulation per ledger cohort.",
  },
  {
    findingId: "perf:cfb-roster-raw-historic",
    findingType: "high_volume_primary_write",
    severity: "HIGH",
    tableName: "cfb_roster_observations",
    indexName: null,
    detail: "Raw historic CFB roster observations are large and no longer required for live team-profile reads.",
    recommendation: "Block seasons <=2025 raw re-ingest on primary; serve archives from cold history / R2.",
    estimatedD1Impact: "Avoids ~hundreds of thousands of raw rows returning to primary.",
  },
  {
    findingId: "perf:retired-cfb-roster-secondary-indexes",
    findingType: "index_retirement_complete",
    severity: "INFO",
    tableName: "cfb_roster_observations",
    indexName: "idx_cfb_roster_obs_player_time,idx_cfb_roster_obs_team_time",
    detail: "Non-unique secondary indexes were retired after consumer audit and reclaimed ~65.7 MB physical.",
    recommendation: "Do not recreate; keep UNIQUE/PK indexes only.",
    estimatedD1Impact: "Already reclaimed; regression would restore unused index pages.",
  },
  {
    findingId: "perf:retired-mlb-subject-index",
    findingType: "index_retirement_complete",
    severity: "INFO",
    tableName: "mlb_market_projections",
    indexName: "idx_mlb_market_proj_subject",
    detail: "Unused subject_id secondary index retired; readers filter by game/date/market.",
    recommendation: "Keep game/market indexes; do not recreate subject index without a proven reader.",
    estimatedD1Impact: "Avoids unused index write amplification on projection inserts.",
  },
  {
    findingId: "perf:sparse-player-index",
    findingType: "index_shape",
    severity: "WATCH",
    tableName: "normalized_market_observations",
    indexName: "idx_norm_market_player",
    detail: "Player index was rebuilt sparse (0106) to reduce empty-key leaf density.",
    recommendation: "Prefer filtered player predicates; avoid SELECT * full scans for board reads.",
    estimatedD1Impact: "Lower index maintenance cost on non-player market rows.",
  },
  {
    findingId: "perf:ops-telemetry-on-primary",
    findingType: "redundant_primary_write",
    severity: "HIGH",
    tableName: "fbis_ops_health",
    indexName: null,
    detail: "Ops control-plane writes historically shared primary D1 with product facts.",
    recommendation: "Prefer OPERATIONS_DB for fbis_ops_* , capacity, retention, and pipeline validation tables.",
    estimatedD1Impact: "Stops steady operational row growth on the 10 GB primary cap.",
  },
  {
    findingId: "perf:dual-market-shadow-writes",
    findingType: "dual_write",
    severity: "WATCH",
    tableName: "normalized_market_observations",
    indexName: null,
    detail: "MARKET_HISTORY_SHADOW_WS mirrors post-commit WS rows; primary remains authoritative.",
    recommendation: "Keep shadow bounded; do not enable unbounded historical backfill mirrors until primary headroom is stable.",
    estimatedD1Impact: "Shadow targets MARKET_HISTORY_DB; primary cost is the original insert only.",
  },
  {
    findingId: "perf:select-star-board-paths",
    findingType: "expensive_query_shape",
    severity: "WATCH",
    tableName: "normalized_market_observations",
    indexName: "idx_shard_market_event,idx_norm_market_player",
    detail: "Wide SELECT * against 50-column market rows increases D1 read units and response latency.",
    recommendation: "Project only card/quote columns on hot paths; reserve full-row reads for parity/evidence probes.",
    estimatedD1Impact: "Reduces bytes scanned and Worker CPU on board/odds endpoints.",
  },
  {
    findingId: "perf:api-usage-source-observations",
    findingType: "operational_growth_candidate",
    severity: "WATCH",
    tableName: "api_usage,source_observations,job_runs",
    indexName: "idx_api_usage_month,idx_job_runs_type_time",
    detail: "Telemetry tables grow continuously and are suitable OPERATIONS_DB candidates after dual-read readiness.",
    recommendation: "Keep current primary reads; route new ops-adjacent telemetry to OPERATIONS_DB where bindings allow.",
    estimatedD1Impact: "Defers primary growth from routine job/API telemetry.",
  },
]);

export function runStaticPerformanceAudit({ now = new Date() } = {}) {
  const recordedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    contract: PERFORMANCE_AUDIT_CONTRACT,
    recordedAt,
    findingCount: KNOWN_PERFORMANCE_FINDINGS.length,
    openHigh: KNOWN_PERFORMANCE_FINDINGS.filter((f) => f.severity === "HIGH").length,
    findings: KNOWN_PERFORMANCE_FINDINGS.map((f) => ({ ...f, recordedAt, status: "OPEN" })),
  };
}

export async function persistPerformanceFindings(env, audit) {
  const { db, preferred, warning } = await resolveReadyOperationsDb(env);
  if (!db?.prepare) return { ok: false, reason: "operations-db-unbound", persisted: 0, warning };
  let persisted = 0;
  for (const finding of audit.findings || []) {
    await db.prepare(
      `INSERT OR REPLACE INTO fbis_d1_performance_findings (
        finding_id, recorded_at, finding_type, severity, table_name, index_name,
        detail, recommendation, estimated_d1_impact, status, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      finding.findingId,
      finding.recordedAt || audit.recordedAt,
      finding.findingType,
      finding.severity,
      finding.tableName,
      finding.indexName,
      finding.detail,
      finding.recommendation,
      finding.estimatedD1Impact,
      finding.status || "OPEN",
      JSON.stringify({
        contract: PERFORMANCE_AUDIT_CONTRACT,
        operationsPreferred: preferred,
        evidenceSha256: createHash("sha256").update(finding.findingId + finding.detail).digest("hex"),
      })
    ).run();
    persisted += 1;
  }
  return { ok: true, persisted, preferredOperationsDb: preferred };
}
