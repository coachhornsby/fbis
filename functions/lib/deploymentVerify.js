/**
 * Production deployment SHA verification.
 * Fail closed on genuine mismatch. Retry temporary health / propagation delay.
 */

export const FULL_SHA_RE = /^[a-f0-9]{40}$/i;

export const VERIFY_OUTCOME = {
  MATCH: "match",
  MISMATCH: "mismatch",
  PROPAGATING: "propagating",
  UNAVAILABLE: "unavailable",
  INVALID_RESPONSE: "invalid-response",
};

export function isFullSha(value) {
  return FULL_SHA_RE.test(String(value || ""));
}

export function classifyHealthResponse({ httpStatus, contentType, json, expectedSha } = {}) {
  const expected = String(expectedSha || "").toLowerCase();
  const type = String(contentType || "").toLowerCase();
  if (!Number.isFinite(Number(httpStatus)) || Number(httpStatus) === 0) {
    return {
      outcome: VERIFY_OUTCOME.UNAVAILABLE,
      retryable: true,
      expectedSha: expected || null,
      actualSha: null,
      reason: "health-unreachable",
    };
  }
  if (Number(httpStatus) >= 500 || Number(httpStatus) === 429) {
    return {
      outcome: VERIFY_OUTCOME.UNAVAILABLE,
      retryable: true,
      expectedSha: expected || null,
      actualSha: null,
      reason: `health-http-${httpStatus}`,
    };
  }
  if (Number(httpStatus) !== 200) {
    return {
      outcome: VERIFY_OUTCOME.INVALID_RESPONSE,
      retryable: Number(httpStatus) >= 400 && Number(httpStatus) < 500 ? false : true,
      expectedSha: expected || null,
      actualSha: null,
      reason: `health-http-${httpStatus}`,
    };
  }
  if (!type.includes("application/json")) {
    return {
      outcome: VERIFY_OUTCOME.INVALID_RESPONSE,
      retryable: true,
      expectedSha: expected || null,
      actualSha: null,
      reason: "health-content-type",
    };
  }
  if (!json || typeof json !== "object" || json.ok !== true) {
    return {
      outcome: VERIFY_OUTCOME.INVALID_RESPONSE,
      retryable: true,
      expectedSha: expected || null,
      actualSha: null,
      reason: "health-shape",
    };
  }
  const actual = json.deploymentCommit ?? json.build?.commitSha ?? null;
  if (actual == null || actual === "" || actual === "unavailable") {
    return {
      outcome: VERIFY_OUTCOME.PROPAGATING,
      retryable: true,
      expectedSha: expected || null,
      actualSha: actual == null ? null : String(actual),
      reason: "sha-unavailable",
    };
  }
  const actualSha = String(actual).toLowerCase();
  if (!isFullSha(actualSha) || !isFullSha(expected)) {
    return {
      outcome: VERIFY_OUTCOME.PROPAGATING,
      retryable: true,
      expectedSha: expected || null,
      actualSha,
      reason: "sha-not-full-40",
    };
  }
  if (actualSha !== expected) {
    return {
      outcome: VERIFY_OUTCOME.MISMATCH,
      retryable: true,
      expectedSha: expected,
      actualSha,
      reason: "sha-mismatch",
    };
  }
  return {
    outcome: VERIFY_OUTCOME.MATCH,
    retryable: false,
    expectedSha: expected,
    actualSha,
    reason: null,
  };
}

export function nextVerifyDelayMs(attempt, { outcome } = {}) {
  const n = Math.max(1, Number(attempt) || 1);
  if (outcome === VERIFY_OUTCOME.MISMATCH) return Math.min(8000, 2000 * n);
  if (outcome === VERIFY_OUTCOME.PROPAGATING) return Math.min(20000, 4000 * n);
  return Math.min(15000, 3000 * n);
}

export function shouldFailClosed(result, { attempts, maxAttempts } = {}) {
  if (!result) return true;
  if (result.outcome === VERIFY_OUTCOME.MATCH) return false;
  if (result.outcome === VERIFY_OUTCOME.MISMATCH && attempts >= 3) return true;
  return attempts >= (maxAttempts || 12);
}
