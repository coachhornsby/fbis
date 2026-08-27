/**
 * Cloudflare free-plan storage budget reporting.
 * Warns before 70 / 85 / 95% of a listed limit.
 */

import { hasDb } from "./store.js";
import { queryTableCounts } from "./collegeStore.js";
import { r2Bound, r2PrefixBytes } from "./r2Archive.js";

export const STORAGE_LIMITS = {
  d1DbBytes: 500 * 1024 * 1024,
  d1AccountBytes: 5 * 1024 * 1024 * 1024,
  d1ReadsPerDay: 5_000_000,
  d1WritesPerDay: 100_000,
  r2Bytes: 10 * 1024 * 1024 * 1024,
};

export const STORAGE_WARN = [0.7, 0.85, 0.95];

const MAJOR_TABLES = [
  "games",
  "predictions",
  "prediction_snapshots",
  "odds_snapshots",
  "job_runs",
  "strategy_tickets",
  "executed_bets",
  "source_observations",
  "team_feature_snapshots",
  "game_feature_snapshots",
  "model_predictions",
  "api_usage",
  "team_season_identity",
];

export function warnLevel(used, cap) {
  if (!cap) return "unknown";
  const pct = used / cap;
  if (pct >= 0.95) return "critical";
  if (pct >= 0.85) return "high";
  if (pct >= 0.7) return "watch";
  return "ok";
}

export function metricUnavailable(n, reason = "N=0 — unavailable") {
  if (n == null || Number(n) === 0) {
    return { available: false, n: 0, value: null, display: reason, reason };
  }
  return { available: true, n: Number(n), value: null, display: null, reason: null };
}

export async function storageBudget(env = {}) {
  const tables = await queryTableCounts(env, MAJOR_TABLES);
  let d1Size = null;
  if (hasDb(env)) {
    try {
      const row = await env.DB.prepare(
        "SELECT SUM(pgsize) AS bytes FROM dbstat"
      ).first();
      d1Size = Number(row?.bytes) || null;
    } catch {
      d1Size = null;
    }
  }
  const r2 = r2Bound(env)
    ? {
        bound: true,
        raw: await r2PrefixBytes(env, "raw/"),
        features: await r2PrefixBytes(env, "features/"),
        models: await r2PrefixBytes(env, "models/"),
        reports: await r2PrefixBytes(env, "reports/"),
      }
    : { bound: false, reason: "R2 ARCHIVE binding not configured", setup: "See CLOUDFLARE_SETUP.md" };
  const r2Bytes = r2.bound
    ? (r2.raw.bytes || 0) + (r2.features.bytes || 0) + (r2.models.bytes || 0) + (r2.reports.bytes || 0)
    : 0;
  const rows = Object.values(tables).reduce((s, v) => s + (Number(v) || 0), 0);
  const monthlyGrowthRows = Math.round(rows * 0.15) || 200;
  const monthlyGrowthBytes = d1Size ? Math.round(d1Size * 0.12) : null;
  return {
    d1Bound: hasDb(env),
    d1Bytes: d1Size,
    d1BytesLimit: STORAGE_LIMITS.d1DbBytes,
    d1Level: d1Size != null ? warnLevel(d1Size, STORAGE_LIMITS.d1DbBytes) : "unknown",
    tables,
    tableRows: rows,
    r2,
    r2Bytes,
    r2Limit: STORAGE_LIMITS.r2Bytes,
    r2Level: r2.bound ? warnLevel(r2Bytes, STORAGE_LIMITS.r2Bytes) : "unbound",
    estimatedMonthlyGrowthRows: monthlyGrowthRows,
    estimatedMonthlyGrowthBytes: monthlyGrowthBytes,
    warnings: [
      d1Size != null && d1Size / STORAGE_LIMITS.d1DbBytes >= 0.7 ? `D1 at ${warnLevel(d1Size, STORAGE_LIMITS.d1DbBytes)}` : null,
      r2.bound && r2Bytes / STORAGE_LIMITS.r2Bytes >= 0.7 ? `R2 at ${warnLevel(r2Bytes, STORAGE_LIMITS.r2Bytes)}` : null,
    ].filter(Boolean),
  };
}
