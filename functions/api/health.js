import { durableHealth, deploymentCommit, scheduledHealth } from "../lib/jobs.js";
import { MODEL_VERSION } from "../lib/weights.js";
import { deriveHealthState, writeVerificationState } from "../lib/healthContract.js";

/**
 * Read-only health endpoint.
 * - No upstream API calls
 * - No projection writes
 * - No freeze/harvest side effects
 */
export async function onRequestGet(context) {
  const env = {
    DB: context.env.DB,
    CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
    CF_PAGES_COMMIT: context.env.CF_PAGES_COMMIT,
    GITHUB_SHA: context.env.GITHUB_SHA,
    COMMIT_SHA: context.env.COMMIT_SHA,
  };
  try {
    const health = await durableHealth(env);
    const schedule = scheduledHealth(health, new Date());
    const readOk = Boolean(health.bound) && String(health.source || "") === "d1";
    const writeVerification = writeVerificationState({
      readOk,
      lastWriteSuccessAt: health.lastD1WriteSuccessAt || null,
      failedWrites: Number(health.failedWrites || 0) + Number(health.failedHarvests || 0),
      reason: health.lastError || health.source || "",
    });
    const writeOk = writeVerification === "VERIFIED";
    const collectHealthy = schedule?.collect?.state === "healthy";
    const harvestHealthy = schedule?.harvest?.state === "healthy";
    const derived = deriveHealthState({
      hasAuthoritativeData: readOk,
      requiredChecks: [
        { name: "d1-binding", ok: Boolean(health.bound), detail: health.bound ? "bound" : "unbound" },
        { name: "d1-read", ok: readOk, detail: health.source || "unknown" },
        { name: "d1-write", ok: writeOk, detail: `failedWrites=${Number(health.failedWrites || 0)} failedHarvests=${Number(health.failedHarvests || 0)}` },
        {
          name: "scheduled-collect",
          ok: collectHealthy,
          detail: schedule?.collect?.state || "unknown",
          lastSuccessAt: health.lastScheduledCollectSuccessAt || null,
          freshnessMs: 8 * 60 * 60 * 1000,
        },
        {
          name: "scheduled-harvest",
          ok: harvestHealthy,
          detail: schedule?.harvest?.state || "unknown",
          lastSuccessAt: health.lastScheduledHarvestSuccessAt || null,
          freshnessMs: 8 * 60 * 60 * 1000,
        },
      ],
    });
    return json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        deploymentCommit: deploymentCommit(env),
        modelVersion: MODEL_VERSION,
        state: derived.state,
        d1: {
          bound: Boolean(health.bound),
          source: health.source || (health.bound ? "d1" : "unbound"),
          lastD1WriteSuccessAt: health.lastD1WriteSuccessAt || null,
          readOk,
          writeOk,
          writeVerification,
        },
        pipeline: {
          lastCollectSuccessAt: health.lastCollectSuccessAt || null,
          lastCollectAttemptAt: health.lastCollectAttemptAt || null,
          lastHarvestSuccessAt: health.lastHarvestSuccessAt || null,
          lastHarvestAttemptAt: health.lastHarvestAttemptAt || null,
          lastFailedCollectAt: health.lastFailedCollectAt || null,
          lastFailedHarvestAt: health.lastFailedHarvestAt || null,
          failedWrites: Number(health.failedWrites || 0),
          failedHarvests: Number(health.failedHarvests || 0),
          retryOpen: Number(health.retryOpen || 0),
          immutableConflicts: Number(health.immutableConflicts || 0),
          schedule,
        },
        checks: derived.checks,
        failures: derived.failures,
        lastJob: health.lastJob || null,
      },
      200,
      15
    );
  } catch (err) {
    return json(
      {
        ok: false,
        error: String(err?.message || err),
        generatedAt: new Date().toISOString(),
        deploymentCommit: deploymentCommit(env),
      },
      500,
      5
    );
  }
}

function json(data, status = 200, maxAge = 15) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      "access-control-allow-origin": "*",
    },
  });
}
