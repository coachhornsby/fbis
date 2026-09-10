/**
 * CLI-equivalent of GitHub deployment SHA verification.
 * Research writers fail closed unless the exact production SHA is verified.
 */
import { pathToFileURL } from "node:url";
import {
  classifyHealthResponse,
  isFullSha,
  nextVerifyDelayMs,
  shouldFailClosed,
  VERIFY_OUTCOME,
} from "../functions/lib/deploymentVerify.js";

/** Real backoff used by CLI and by callers that omit `sleep`. Tests may inject a no-op. */
export async function defaultVerifySleep(attempt, outcome) {
  const ms = nextVerifyDelayMs(attempt, { outcome });
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Verify live /api/health reports exactly `expectedSha` (40-char).
 * Distinguishes propagating / unavailable / mismatch; fail-closed on genuine mismatch
 * after bounded retries — never on the first rapid back-to-back mismatch.
 */
export async function verifyDeploymentSha({
  fetchHealth,
  expectedSha,
  maxAttempts = 12,
  sleep = defaultVerifySleep,
} = {}) {
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let httpStatus = 0;
    let contentType = "";
    let json = null;
    try {
      const res = await fetchHealth();
      httpStatus = Number(res.status) || 0;
      contentType = res.contentType || "";
      json = res.json || null;
    } catch {
      httpStatus = 0;
    }
    last = classifyHealthResponse({ httpStatus, contentType, json, expectedSha });
    last.attempt = attempt;
    if (last.outcome === VERIFY_OUTCOME.MATCH) return last;
    if (shouldFailClosed(last, { attempts: attempt, maxAttempts })) return last;
    if (last.retryable) await sleep(attempt, last.outcome);
  }
  return last;
}

/**
 * Resolve the currently live production SHA for scheduled research.
 * Does not compare against a workflow checkout SHA — that races active deploys.
 * Fail-closed if health never yields a full 40-char SHA.
 */
export async function resolveLiveProductionSha({
  fetchHealth,
  maxAttempts = 12,
  sleep = defaultVerifySleep,
} = {}) {
  let last = {
    outcome: VERIFY_OUTCOME.UNAVAILABLE,
    retryable: true,
    expectedSha: null,
    actualSha: null,
    reason: "health-unreachable",
    attempt: 0,
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let httpStatus = 0;
    let contentType = "";
    let json = null;
    try {
      const res = await fetchHealth();
      httpStatus = Number(res.status) || 0;
      contentType = res.contentType || "";
      json = res.json || null;
    } catch {
      httpStatus = 0;
    }
    // Classify against a placeholder expected SHA so HTTP/shape rules apply;
    // then accept any valid live full SHA as the research snapshot.
    const placeholder = "0".repeat(40);
    const classified = classifyHealthResponse({
      httpStatus,
      contentType,
      json,
      expectedSha: placeholder,
    });
    last = { ...classified, attempt, expectedSha: null };
    if (
      classified.outcome === VERIFY_OUTCOME.MATCH ||
      classified.outcome === VERIFY_OUTCOME.MISMATCH
    ) {
      const live = String(classified.actualSha || "").toLowerCase();
      if (isFullSha(live)) {
        return {
          outcome: VERIFY_OUTCOME.MATCH,
          retryable: false,
          expectedSha: live,
          actualSha: live,
          reason: null,
          attempt,
          productionSha: live,
        };
      }
      last = {
        outcome: VERIFY_OUTCOME.PROPAGATING,
        retryable: true,
        expectedSha: null,
        actualSha: live || null,
        reason: "sha-not-full-40",
        attempt,
      };
    }
    if (attempt >= maxAttempts) return { ...last, productionSha: null };
    if (last.retryable) await sleep(attempt, last.outcome);
  }
  return { ...last, productionSha: null };
}

async function fetchLiveHealth(base) {
  const res = await fetch(`${base}/api/health?_t=${Date.now()}`);
  const contentType = res.headers.get("content-type") || "";
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, contentType, json };
}

const isCliMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliMain) {
  const expected = process.argv[2];
  const mode = process.env.VERIFY_MODE || "exact";
  const base = process.env.BASE || "https://fbis-myz.pages.dev";
  const maxAttempts = Number(process.env.VERIFY_MAX_ATTEMPTS || 15) || 15;
  let out;
  if (mode === "resolve-live") {
    out = await resolveLiveProductionSha({
      maxAttempts,
      fetchHealth: () => fetchLiveHealth(base),
    });
  } else {
    if (!expected || !isFullSha(expected)) {
      console.error("Usage: node scripts/verify-deployment-sha.mjs <40-char-sha>");
      process.exit(2);
    }
    out = await verifyDeploymentSha({
      expectedSha: expected,
      maxAttempts,
      fetchHealth: () => fetchLiveHealth(base),
    });
  }
  console.log(JSON.stringify(out));
  process.exit(out.outcome === VERIFY_OUTCOME.MATCH ? 0 : 1);
}
