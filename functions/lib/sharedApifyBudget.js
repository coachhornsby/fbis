/**
 * Shared Apify budget authority for FBIS sports actors.
 * ACTION + PrizePicks combined: target <= $22/month, absolute stop at $25/month.
 */
export const APIFY_SPORTS_TARGET_USD = 22;
export const APIFY_SPORTS_HARD_CAP_USD = 25;
export const APIFY_SPORTS_PRIORITY_ONLY_USD = 24;

export function readSharedApifyBudget(env = {}) {
  const requestedTarget = Number(env.APIFY_SPORTS_MONTHLY_TARGET_USD);
  const requestedCap = Number(env.APIFY_SPORTS_MONTHLY_CAP_USD);
  const hardCapUsd = Math.min(
    Number.isFinite(requestedCap) && requestedCap > 0 ? requestedCap : APIFY_SPORTS_HARD_CAP_USD,
    APIFY_SPORTS_HARD_CAP_USD,
  );
  const targetUsd = Math.min(
    Number.isFinite(requestedTarget) && requestedTarget > 0 ? requestedTarget : APIFY_SPORTS_TARGET_USD,
    hardCapUsd,
  );
  return { targetUsd, hardCapUsd };
}

export function evaluateSharedApifySpend({
  monthToDateUsd = 0,
  estimatedRunUsd = 0,
  priority = false,
  env = {},
} = {}) {
  const { targetUsd, hardCapUsd } = readSharedApifyBudget(env);
  const mtd = Math.max(0, Number(monthToDateUsd) || 0);
  const estimate = Math.max(0, Number(estimatedRunUsd) || 0);
  const projected = mtd + estimate;
  if (projected > hardCapUsd + 1e-9) {
    return { allowed: false, mode: "STOP", reason: "APIFY_SHARED_HARD_CAP", projectedUsd: projected, targetUsd, hardCapUsd };
  }
  if (mtd >= APIFY_SPORTS_PRIORITY_ONLY_USD && !priority) {
    return { allowed: false, mode: "PRIORITY_ONLY", reason: "APIFY_SHARED_PRIORITY_ONLY", projectedUsd: projected, targetUsd, hardCapUsd };
  }
  if (projected > targetUsd && !priority) {
    return { allowed: false, mode: "THROTTLE", reason: "APIFY_SHARED_TARGET_EXCEEDED", projectedUsd: projected, targetUsd, hardCapUsd };
  }
  return { allowed: true, mode: projected > targetUsd ? "RESERVE" : "NORMAL", reason: null, projectedUsd: projected, targetUsd, hardCapUsd };
}

/**
 * Sum all paid Apify sports actors from a unified cost ledger.
 * Falls back to legacy ACTION shadow_cost_ledger when the provider column is absent.
 */
export async function querySharedApifyMonthToDateUsd(db, { now = new Date() } = {}) {
  if (!db?.queryOne) return { mtdUsd: 0, runs: 0 };
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  try {
    const row = await db.queryOne(
      `SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END),0) AS mtd_usd,
              COUNT(*) AS runs
         FROM apify_sports_cost_ledger
        WHERE created_at >= ?`,
      [monthStart],
    );
    return { mtdUsd: Number(row?.mtd_usd || 0), runs: Number(row?.runs || 0), monthStart, source: "apify_sports_cost_ledger" };
  } catch {
    const row = await db.queryOne(
      `SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END),0) AS mtd_usd,
              COUNT(*) AS runs
         FROM shadow_cost_ledger
        WHERE created_at >= ?`,
      [monthStart],
    );
    return { mtdUsd: Number(row?.mtd_usd || 0), runs: Number(row?.runs || 0), monthStart, source: "shadow_cost_ledger" };
  }
}
