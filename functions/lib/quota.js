/**
 * Shared CFBD/CBBD monthly quota ledger. Tier 3 = 75,000 calls across both sports.
 * Production design target is well under the cap. Alerts at 50/75/90/100%.
 * Never stores credentials. Failed sources stay unavailable — never zero-fill.
 */

export const MONTHLY_QUOTA = 75000;
export const QUOTA_DESIGN_TARGET = 30000;
export const QUOTA_ALERTS = [0.4, 0.6, 0.8, 0.9, 1];
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

export function quotaHealth({ used = 0, cacheHits = 0, month = null, cap = MONTHLY_QUOTA, configured = true } = {}) {
  const pct = quotaPct(used, cap);
  let level = configured ? "ok" : "unavailable";
  if (configured && pct >= 1) level = "exhausted";
  else if (configured && pct >= 0.9) level = "critical";
  else if (configured && pct >= 0.8) level = "high";
  else if (configured && pct >= 0.4) level = "watch";
  return {
    month: month || utcMonthKey(),
    used: Number(used) || 0,
    cacheHits: Number(cacheHits) || 0,
    cap,
    remaining: configured ? Math.max(0, cap - (Number(used) || 0)) : null,
    pct: configured ? pct : null,
    level,
    designTarget: QUOTA_DESIGN_TARGET,
    overDesign: (Number(used) || 0) > QUOTA_DESIGN_TARGET,
    alerts: configured ? quotaAlerts(used, cap).map((a) => `${Math.round(a.threshold * 100)}%`) : [],
    configured,
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
  cfbdAuditOnce = 90,
  cfbFbisV2FeatureRefreshPerDay = 12,
} = {}) {
  const daily =
    cfbRefreshPerDay * cfbSeasonDays +
    cbbRefreshPerDay * cbbSeasonDays +
    cfbHarvestPerDay * cfbSeasonDays +
    cbbHarvestPerDay * cbbSeasonDays +
    cfbFbisV2FeatureRefreshPerDay * cfbSeasonDays;
  return {
    estimated: daily + backfillOnce + cfbdAuditOnce,
    dailyProduction: cfbRefreshPerDay + cbbRefreshPerDay + cfbHarvestPerDay + cbbHarvestPerDay + cfbFbisV2FeatureRefreshPerDay,
    dailyCfbFbisV2: cfbFbisV2FeatureRefreshPerDay,
    auditOnce: cfbdAuditOnce,
    underDesign: daily + backfillOnce + cfbdAuditOnce < QUOTA_DESIGN_TARGET,
    underCap: daily + backfillOnce + cfbdAuditOnce < MONTHLY_QUOTA,
    note: "CFB-FBIS-v2 features are scheduled/background only — never from customer page loads",
  };
}

/**
 * Provider-call counters outside FBIS are not in D1 api_usage.
 * A provider-confirmed zero from a current-month 429 supersedes any higher
 * local estimate. Old-month headers never carry into a new billing month.
 */
export function reconcileSharedCollegeQuota(local = {}, provider = {}) {
  const month = local.month || utcMonthKey();
  const confirmedZero = provider?.bound === true &&
    provider?.month === month &&
    Number(provider?.providerRemaining) === 0 &&
    provider?.providerRemaining != null &&
    String(provider?.last429At || "").startsWith(month);
  const localRemaining = local.configured === false ? null : local.remaining ?? null;
  return {
    ...local,
    cap: MONTHLY_QUOTA,
    estimatedLocalUsed: local.used ?? null,
    estimatedLocalRemaining: localRemaining,
    providerReportedRemaining: provider?.providerRemaining ?? null,
    providerLast429At: provider?.last429At ?? null,
    providerConfirmedZero: confirmedZero,
    remaining: confirmedZero ? 0 : localRemaining,
    level: confirmedZero ? "exhausted" : local.level || "unavailable",
    sharedAcross: ["cfbd", "cbbd"],
    balanceSource: confirmedZero ? "provider-confirmed-zero" : "local-estimate-only",
    providerBalanceVerified: confirmedZero,
  };
}
