/**
 * CLI-equivalent of GitHub deployment SHA verification.
 * Used by unit tests; the workflow embeds the same fail-closed rules.
 */
import { classifyHealthResponse, shouldFailClosed, VERIFY_OUTCOME } from "../functions/lib/deploymentVerify.js";

export async function verifyDeploymentSha({
  fetchHealth,
  expectedSha,
  maxAttempts = 12,
  sleep = async () => {},
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

const expected = process.argv[2];
if (expected && import.meta.url === `file://${process.argv[1]}`) {
  const base = process.env.BASE || "https://fbis-myz.pages.dev";
  const out = await verifyDeploymentSha({
    expectedSha: expected,
    fetchHealth: async () => {
      const res = await fetch(`${base}/api/health?_t=${Date.now()}`);
      const contentType = res.headers.get("content-type") || "";
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, contentType, json };
    },
  });
  console.log(JSON.stringify(out));
  process.exit(out.outcome === "match" ? 0 : 1);
}
