export const HEALTH_STATE = {
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  UNAVAILABLE: "UNAVAILABLE",
  STALE: "STALE",
};

function ts(value) {
  if (!value) return null;
  const at = Date.parse(String(value));
  return Number.isFinite(at) ? at : null;
}

function stale(lastSuccessAt, freshnessMs, nowMs) {
  const at = ts(lastSuccessAt);
  if (!at || !Number.isFinite(freshnessMs) || freshnessMs <= 0) return false;
  return nowMs - at > freshnessMs;
}

export function deriveHealthState({
  now = Date.now(),
  hasAuthoritativeData = true,
  usingLastKnownGood = false,
  requiredChecks = [],
} = {}) {
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const checks = (requiredChecks || []).map((row) => {
    const ok = row?.ok === true;
    const required = row?.required !== false;
    const freshnessMs = Number(row?.freshnessMs || 0) || 0;
    const staleNow = stale(row?.lastSuccessAt, freshnessMs, nowMs);
    return {
      name: row?.name || "unknown",
      required,
      ok,
      stale: staleNow,
      freshnessMs: freshnessMs || null,
      lastSuccessAt: row?.lastSuccessAt || null,
      detail: row?.detail || null,
      error: row?.error ? String(row.error) : null,
      source: row?.source || null,
    };
  });
  const failures = checks.filter((c) => c.required && !c.ok);
  const staleChecks = checks.filter((c) => c.required && c.stale);
  if (!hasAuthoritativeData) {
    return { state: HEALTH_STATE.UNAVAILABLE, failures, staleChecks, checks };
  }
  if (usingLastKnownGood) {
    return { state: HEALTH_STATE.STALE, failures, staleChecks, checks };
  }
  if (failures.length || staleChecks.length) {
    return { state: HEALTH_STATE.DEGRADED, failures, staleChecks, checks };
  }
  return { state: HEALTH_STATE.HEALTHY, failures, staleChecks, checks };
}
