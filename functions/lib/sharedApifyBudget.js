import {billingWindow} from './externalAcquisition.js';
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
  const hardCapUsd = Math.min(Number.isFinite(requestedCap) && requestedCap > 0 ? requestedCap : APIFY_SPORTS_HARD_CAP_USD, APIFY_SPORTS_HARD_CAP_USD);
  const targetUsd = Math.min(Number.isFinite(requestedTarget) && requestedTarget > 0 ? requestedTarget : APIFY_SPORTS_TARGET_USD, hardCapUsd);
  return { targetUsd, hardCapUsd };
}

export function evaluateSharedApifySpend({ monthToDateUsd = 0, estimatedRunUsd = 0, priority = false, env = {} } = {}) {
  const { targetUsd, hardCapUsd } = readSharedApifyBudget(env);
  const mtd = Math.max(0, Number(monthToDateUsd) || 0);
  const estimate = Math.max(0, Number(estimatedRunUsd) || 0);
  const projected = mtd + estimate;
  if (projected > hardCapUsd + 1e-9) return { allowed:false, mode:"STOP", reason:"APIFY_SHARED_HARD_CAP", projectedUsd:projected, targetUsd, hardCapUsd };
  if (mtd >= APIFY_SPORTS_PRIORITY_ONLY_USD && !priority) return { allowed:false, mode:"PRIORITY_ONLY", reason:"APIFY_SHARED_PRIORITY_ONLY", projectedUsd:projected, targetUsd, hardCapUsd };
  if (projected > targetUsd && !priority) return { allowed:false, mode:"THROTTLE", reason:"APIFY_SHARED_TARGET_EXCEEDED", projectedUsd:projected, targetUsd, hardCapUsd };
  return { allowed:true, mode:projected > targetUsd ? "RESERVE" : "NORMAL", reason:null, projectedUsd:projected, targetUsd, hardCapUsd };
}

/**
 * Combined MTD spend. ACTION remains in its legacy shadow_cost_ledger; dedicated
 * paid actors such as PrizePicks use apify_sports_cost_ledger.
 */
export async function querySharedApifyMonthToDateUsd(db, { now = new Date() } = {}) {
  if (!db?.queryOne) return { mtdUsd:0, runs:0 };
  const monthStart = billingWindow(now).start;
  let actionUsd=0, actionRuns=0, otherUsd=0, otherRuns=0;
  try {
    const a=await db.queryOne(
      `SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END),0) AS mtd_usd, COUNT(*) AS runs
       FROM shadow_cost_ledger WHERE created_at >= ? AND NOT EXISTS (SELECT 1 FROM apify_sports_cost_ledger p WHERE p.run_id=shadow_cost_ledger.run_id)`, [monthStart]);
    actionUsd=Number(a?.mtd_usd||0); actionRuns=Number(a?.runs||0);
  } catch {}
  try {
    const p=await db.queryOne(
      `SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END),0) AS mtd_usd, COUNT(*) AS runs
       FROM apify_sports_cost_ledger WHERE created_at >= ?`, [monthStart]);
    otherUsd=Number(p?.mtd_usd||0); otherRuns=Number(p?.runs||0);
  } catch {}
  return {
    mtdUsd: Math.round((actionUsd+otherUsd)*10000)/10000,
    runs: actionRuns+otherRuns,
    monthStart,
    actionUsd,
    otherApifyUsd:otherUsd,
    source:"combined",
  };
}
