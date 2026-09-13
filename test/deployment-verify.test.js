import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyHealthResponse,
  collectionAllowedAfterVerify,
  nextVerifyDelayMs,
  shouldFailClosed,
  VERIFY_OUTCOME,
} from "../functions/lib/deploymentVerify.js";
import {
  defaultVerifySleep,
  resolveLiveProductionSha,
  verifyDeploymentSha,
} from "../scripts/verify-deployment-sha.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function healthOk(commit) {
  return {
    status: 200,
    contentType: "application/json",
    json: { ok: true, deploymentCommit: commit },
  };
}

describe("deployment SHA verify orchestration", () => {
  it("defaultVerifySleep uses nextVerifyDelayMs (non-zero wait)", async () => {
    const expected = nextVerifyDelayMs(1, { outcome: VERIFY_OUTCOME.MISMATCH });
    assert.ok(expected >= 1000);
    const t0 = Date.now();
    await defaultVerifySleep(1, VERIFY_OUTCOME.MISMATCH);
    const elapsed = Date.now() - t0;
    // Allow timer slack but require a real wait (not the old no-op).
    assert.ok(elapsed >= expected - 50, `elapsed=${elapsed} expected~${expected}`);
  });

  it("previous SHA for early attempts can later become expected and succeed", async () => {
    const responses = [healthOk(SHA_B), healthOk(SHA_B), healthOk(SHA_A)];
    let i = 0;
    const sleeps = [];
    const result = await verifyDeploymentSha({
      expectedSha: SHA_A,
      maxAttempts: 12,
      sleep: async (attempt, outcome) => {
        sleeps.push({ attempt, outcome });
      },
      fetchHealth: async () => responses[Math.min(i++, responses.length - 1)],
    });
    assert.equal(result.outcome, VERIFY_OUTCOME.MATCH);
    assert.equal(result.actualSha, SHA_A);
    assert.equal(result.attempt, 3);
    assert.equal(sleeps.length, 2);
    assert.equal(sleeps[0].outcome, VERIFY_OUTCOME.MISMATCH);
    assert.equal(collectionAllowedAfterVerify(result), true);
  });

  it("permanent wrong SHA still fails closed", async () => {
    const result = await verifyDeploymentSha({
      expectedSha: SHA_A,
      maxAttempts: 12,
      sleep: async () => {},
      fetchHealth: async () => healthOk(SHA_B),
    });
    assert.equal(result.outcome, VERIFY_OUTCOME.MISMATCH);
    assert.equal(result.actualSha, SHA_B);
    assert.equal(result.attempt, 12, `fail-closed attempt=${result.attempt}`);
    assert.equal(shouldFailClosed(result, { attempts: result.attempt, maxAttempts: 12 }), true);
    assert.equal(collectionAllowedAfterVerify(result), false);
  });

  it("5xx / 429 / unreachable conditions retry then can match", async () => {
    const sequence = [
      () => {
        throw new Error("network down");
      },
      () => ({ status: 503, contentType: "text/plain", json: null }),
      () => ({ status: 429, contentType: "application/json", json: { ok: false } }),
      () => ({ status: 502, contentType: "text/html", json: null }),
      () => healthOk(SHA_A),
    ];
    let i = 0;
    const outcomes = [];
    const result = await verifyDeploymentSha({
      expectedSha: SHA_A,
      maxAttempts: 12,
      sleep: async (_a, outcome) => {
        outcomes.push(outcome);
      },
      fetchHealth: async () => sequence[i++](),
    });
    assert.equal(result.outcome, VERIFY_OUTCOME.MATCH);
    assert.ok(outcomes.includes(VERIFY_OUTCOME.UNAVAILABLE));
    assert.equal(classifyHealthResponse({ httpStatus: 503, expectedSha: SHA_A }).retryable, true);
    assert.equal(classifyHealthResponse({ httpStatus: 429, expectedSha: SHA_A }).retryable, true);
    assert.equal(classifyHealthResponse({ httpStatus: 0, expectedSha: SHA_A }).retryable, true);
  });

  it("malformed / non-JSON health responses do not falsely pass", async () => {
    const bad = [
      { status: 200, contentType: "text/html", json: null },
      { status: 200, contentType: "application/json", json: { ok: false } },
      { status: 200, contentType: "application/json", json: null },
      { status: 200, contentType: "application/json", json: { ok: true, deploymentCommit: "short" } },
      { status: 200, contentType: "application/json", json: { ok: true, deploymentCommit: "unavailable" } },
    ];
    for (const res of bad) {
      const classified = classifyHealthResponse({ ...res, expectedSha: SHA_A });
      assert.notEqual(classified.outcome, VERIFY_OUTCOME.MATCH);
      assert.equal(collectionAllowedAfterVerify(classified), false);
    }
    const result = await verifyDeploymentSha({
      expectedSha: SHA_A,
      maxAttempts: 5,
      sleep: async () => {},
      fetchHealth: async () => bad[0],
    });
    assert.notEqual(result.outcome, VERIFY_OUTCOME.MATCH);
    assert.equal(collectionAllowedAfterVerify(result), false);
  });

  it("resolveLiveProductionSha accepts live full SHA without matching checkout", async () => {
    const result = await resolveLiveProductionSha({
      maxAttempts: 4,
      sleep: async () => {},
      fetchHealth: async () => healthOk(SHA_B),
    });
    assert.equal(result.outcome, VERIFY_OUTCOME.MATCH);
    assert.equal(result.productionSha, SHA_B);
    assert.equal(result.actualSha, SHA_B);
    assert.equal(collectionAllowedAfterVerify(result), true);
  });

  it("resolveLiveProductionSha fails closed when SHA never becomes available", async () => {
    const result = await resolveLiveProductionSha({
      maxAttempts: 3,
      sleep: async () => {},
      fetchHealth: async () => ({
        status: 200,
        contentType: "application/json",
        json: { ok: true, deploymentCommit: null },
      }),
    });
    assert.notEqual(result.outcome, VERIFY_OUTCOME.MATCH);
    assert.equal(result.productionSha, null);
    assert.equal(collectionAllowedAfterVerify(result), false);
  });
});
