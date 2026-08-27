/**
 * Shared CFBD/CBBD monthly quota ledger. Tier 2 = 30,000 calls.
 * Production design target is well under the cap. Alerts at 50/75/90/100%.
 * Never stores credentials. Failed sources stay unavailable — never zero-fill.
 */

export const MONTHLY_QUOTA = 30000;
export const QUOTA_DESIGN_TARGET = 8000;
export const QUOTA_ALERTS = [0.5, 0.75, 0.9, 1];
export const QUOTA_COST = { default: 1, cacheHit: 0 };

export function utcMonthKey(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function quotaPct(used, cap = MONTHLY_QUOTA) {
  if (!cap) return null;
  return Number(used || 0) / cap;
}

export function quotaAlerts(used, cap = MONTHLY_QUOTA, fired = []) {
  const pct = quotaPct(used, cap);
  const out = [];
  for (const thr of QUOTA_ALERTS) {
    if (pct >= thr && !fired.includes(thr)) out.push({ threshold: thr, pct, used, cap });
  }
  return out;
}

export function quotaHealth({ used = 0, cacheHits = 0, month = null, cap = MONTHLY_QUOTA } = {}) {
  const pct = quotaPct(used, cap);
  let level = "ok";
  if (pct >= 1) level = "exhausted";
  else if (pct >= 0.9) level = "critical";
  else if (pct >= 0.75) level = "high";
  else if (pct >= 0.5) level = "watch";
  return {
    month: month || utcMonthKey(),
    used: Number(used) || 0,
    cacheHits: Number(cacheHits) || 0,
    cap,
    remaining: Math.max(0, cap - (Number(used) || 0)),
    pct,
    level,
    designTarget: QUOTA_DESIGN_TARGET,
    overDesign: (Number(used) || 0) > QUOTA_DESIGN_TARGET,
    alerts: quotaAlerts(used, cap).map((a) => `${Math.round(a.threshold * 100)}%`),
    configured: true,
  };
}

export function estimateMonthlyCalls({
  cfbRefreshPerDay = 8,
  cbbRefreshPerDay = 5,
  cfbHarvestPerDay = 3,
  cbbHarvestPerDay = 2,
  cfbSeasonDays = 120,
  cbbSeasonDays = 150,
  backfillOnce = 400,
} = {}) {
  const daily =
    cfbRefreshPerDay * cfbSeasonDays +
    cbbRefreshPerDay * cbbSeasonDays +
    cfbHarvestPerDay * cfbSeasonDays +
    cbbHarvestPerDay * cbbSeasonDays;
  return {
    estimated: daily + backfillOnce,
    dailyProduction: cfbRefreshPerDay + cbbRefreshPerDay + cfbHarvestPerDay + cbbHarvestPerDay,
    underDesign: daily + backfillOnce < QUOTA_DESIGN_TARGET,
    underCap: daily + backfillOnce < MONTHLY_QUOTA,
  };
}
