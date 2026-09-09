export const HEALTH_STATE = {
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  UNAVAILABLE: "UNAVAILABLE",
  STALE: "STALE",
};

export const WRITE_VERIFICATION = {
  VERIFIED: "VERIFIED",
  UNVERIFIED: "UNVERIFIED",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
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
    const required = row?.required !== false;
    const freshnessMs = Number(row?.freshnessMs || 0) || 0;
    const staleNow = stale(row?.lastSuccessAt, freshnessMs, nowMs);
    // Required freshness windows must fail closed: stale + "healthy" schedule
    // text was letting the watchdog skip recovery while overall state looked confusing.
    const ok = row?.ok === true && !staleNow;
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

export function blockedByPlatform(reason = "") {
  const msg = String(reason || "").toLowerCase();
  return msg.includes("quota") || msg.includes("exceeded") || msg.includes("d1_error") || msg.includes("platform");
}

export function writeVerificationState({
  readOk = false,
  lastWriteSuccessAt = null,
  lastReadbackSuccessAt = null,
  lastFailureAt = null,
  failedWrites = 0,
  reason = "",
} = {}) {
  if (blockedByPlatform(reason)) return WRITE_VERIFICATION.BLOCKED;
  const writeTs = ts(lastWriteSuccessAt);
  const readbackTs = ts(lastReadbackSuccessAt);
  const failureTs = ts(lastFailureAt);
  const hasRecentWrite = Boolean(writeTs) && (!failureTs || writeTs >= failureTs);
  const hasRecentReadback = Boolean(readbackTs) && (!failureTs || readbackTs >= failureTs);
  if (readOk && hasRecentWrite && hasRecentReadback) return WRITE_VERIFICATION.VERIFIED;
  if (failureTs && (!writeTs || failureTs > writeTs)) return WRITE_VERIFICATION.FAILED;
  if (Number(failedWrites || 0) > 0 && !hasRecentWrite) return WRITE_VERIFICATION.FAILED;
  if (readOk && hasRecentWrite) return WRITE_VERIFICATION.VERIFIED;
  return WRITE_VERIFICATION.UNVERIFIED;
}
