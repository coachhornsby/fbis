/**
 * Dual-read shadow hooks for sport D1 pilots.
 * Primary remains authoritative; sport DB is compared only for parity telemetry.
 * Never upgrades canAuthorizeWager or reroutes live product reads.
 */
import { resolveSportDb } from "./databaseTopology.js";

async function count(db, sql, ...params) {
  if (!db?.prepare) return null;
  try {
    const stmt = db.prepare(sql);
    const row = params.length
      ? await stmt.bind(...params).first()
      : (typeof stmt.first === "function" ? await stmt.first() : await stmt.bind().first());
    return Number(row?.n) || 0;
  } catch {
    return null;
  }
}

/**
 * Compare primary vs sport-DB row counts for a sport working set.
 * Used by board/ops shadow paths without changing read authority.
 */
export async function shadowCompareSportDb(env, sport, {
  tables = [
    { name: "games", sql: "SELECT COUNT(*) n FROM games WHERE sport=?" },
    { name: "prediction_snapshots", sql: "SELECT COUNT(*) n FROM prediction_snapshots WHERE sport=?" },
    { name: "published_projections", sql: "SELECT COUNT(*) n FROM published_projections WHERE sport=?" },
  ],
  now = new Date(),
} = {}) {
  const resolved = resolveSportDb(env, sport);
  const primary = env?.DB;
  const sportDb = resolved.sportDb || (resolved.preferred ? resolved.db : null);
  if (!primary?.prepare) {
    return { ok: false, reason: "PRIMARY_UNBOUND", sport, canAuthorizeWager: false };
  }
  if (!sportDb?.prepare) {
    return {
      ok: false,
      reason: resolved.reason || "SPORT_DB_UNBOUND",
      sport,
      mode: resolved.mode,
      binding: resolved.binding,
      canAuthorizeWager: false,
    };
  }

  const comparisons = [];
  let matched = 0;
  for (const table of tables) {
    const primaryCount = await count(primary, table.sql, sport);
    const sportCount = await count(sportDb, table.sql, sport);
    const equal = primaryCount != null && sportCount != null && primaryCount === sportCount;
    if (equal) matched += 1;
    comparisons.push({
      table: table.name,
      primaryCount,
      sportCount,
      status: primaryCount == null || sportCount == null ? "PROBE_FAILED" : equal ? "PARITY" : "DIVERGED",
    });
  }

  const status = matched === tables.length ? "SHADOW_PARITY_OK" : "SHADOW_PARITY_INCOMPLETE";
  return {
    ok: status === "SHADOW_PARITY_OK",
    status,
    sport,
    mode: resolved.mode,
    primaryAuthoritative: resolved.mode !== "sport",
    liveReadsRerouted: resolved.mode === "sport",
    checkedAt: now.toISOString(),
    matchedTables: matched,
    tableCount: tables.length,
    comparisons,
    plan: resolved.plan || null,
    canAuthorizeWager: false,
  };
}

/** Convenience NHL dual-read shadow used by topology operator API. */
export async function shadowCompareNhlSportDb(env, opts = {}) {
  return shadowCompareSportDb(env, "nhl", opts);
}
