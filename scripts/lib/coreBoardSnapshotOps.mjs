/**
 * Production ops helpers for CORE cross-sport board snapshot publish + freshness.
 * Fail closed: incomplete/stale/missing snapshots are never "ok".
 */

export const CORE_BOARD_SUMMARY_MAX_AGE_MS = 15 * 60 * 1000;
export const CORE_BOARD_EXPECTED_SPORT_COUNT = 11;

/**
 * Evaluate a publishCrossSportBoardSummary API response.
 */
export function evaluateCorePublishResult(body = {}) {
  const failures = [];
  if (!body || typeof body !== "object") {
    return { ok: false, failures: ["PUBLISH_RESPONSE_INVALID"], canAuthorizeWager: false };
  }
  if (body.ok !== true) failures.push(body.reason || "PUBLISH_NOT_OK");
  if (body.canAuthorizeWager === true) failures.push("WAGER_AUTHORITY_MUST_STAY_FALSE");
  const summary = body.summary;
  if (!summary || typeof summary !== "object") {
    failures.push("SUMMARY_MISSING");
  } else {
    if (summary.complete !== true) failures.push("SUMMARY_INCOMPLETE");
    const sports = Array.isArray(summary.sports) ? summary.sports : [];
    if (sports.length !== CORE_BOARD_EXPECTED_SPORT_COUNT) {
      failures.push(`SPORT_COUNT_${sports.length}_EXPECTED_${CORE_BOARD_EXPECTED_SPORT_COUNT}`);
    }
    if (Array.isArray(summary.incompleteSports) && summary.incompleteSports.length) {
      failures.push(`INCOMPLETE_SPORTS_${summary.incompleteSports.join(",")}`);
    }
    if (summary.sourceBinding && summary.sourceBinding !== "CORE_DB" && summary.sourceBinding !== "DB") {
      failures.push(`UNEXPECTED_SOURCE_BINDING_${summary.sourceBinding}`);
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    asOf: summary?.asOf || null,
    sportCount: Array.isArray(summary?.sports) ? summary.sports.length : 0,
    canAuthorizeWager: false,
  };
}

/**
 * Evaluate a require-fresh / read CORE summary response against the 15-minute SLA.
 */
export function evaluateCoreFreshnessResult(body = {}, {
  now = new Date(),
  maxAgeMs = CORE_BOARD_SUMMARY_MAX_AGE_MS,
} = {}) {
  const failures = [];
  if (!body || typeof body !== "object") {
    return { ok: false, failures: ["FRESHNESS_RESPONSE_INVALID"], canAuthorizeWager: false };
  }
  if (body.ok !== true && body.usable !== true) {
    failures.push(body.reason || "CORE_SUMMARY_NOT_USABLE");
  }
  if (body.canAuthorizeWager === true) failures.push("WAGER_AUTHORITY_MUST_STAY_FALSE");

  const asOf = body.asOf || body.summary?.asOf || null;
  const at = Date.parse(asOf);
  let ageMs = null;
  if (!Number.isFinite(at)) {
    failures.push("AS_OF_UNPARSEABLE");
  } else {
    ageMs = Math.max(0, now.getTime() - at);
    if (ageMs > maxAgeMs) failures.push("SUMMARY_STALE");
  }

  const freshness = body.freshness || {
    fresh: failures.length === 0,
    reason: failures[0] || "WITHIN_SLA",
    ageMs,
    maxAgeMs,
  };

  return {
    ok: failures.length === 0,
    failures,
    asOf,
    ageMs,
    maxAgeMs,
    freshness,
    canAuthorizeWager: false,
  };
}

/**
 * Combine publish + freshness into one ops verdict for CI / cron.
 */
export function evaluateCoreSnapshotOpsCycle({
  publish = null,
  freshness = null,
  now = new Date(),
  maxAgeMs = CORE_BOARD_SUMMARY_MAX_AGE_MS,
} = {}) {
  const publishEval = evaluateCorePublishResult(publish);
  const freshEval = evaluateCoreFreshnessResult(freshness, { now, maxAgeMs });
  const failures = [...publishEval.failures, ...freshEval.failures];
  return {
    ok: failures.length === 0,
    failures,
    publish: publishEval,
    freshness: freshEval,
    checkedAt: now.toISOString(),
    canAuthorizeWager: false,
  };
}
