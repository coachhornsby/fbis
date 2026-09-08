import { durableHealth, deploymentCommit, scheduledHealth } from "../lib/jobs.js";
import { MODEL_VERSION } from "../lib/weights.js";
import { deriveHealthState, writeVerificationState } from "../lib/healthContract.js";

const MIGRATION_STATUS = {
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  UNVERIFIED: "UNVERIFIED",
};

const EXPECTED_MIGRATION = "0016_published_projections";

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
    CF_PAGES_BRANCH: context.env.CF_PAGES_BRANCH,
    CF_PAGES_URL: context.env.CF_PAGES_URL,
    CF_PAGES_DEPLOYMENT_ID: context.env.CF_PAGES_DEPLOYMENT_ID,
    BUILD_TIMESTAMP: context.env.BUILD_TIMESTAMP,
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
      lastReadbackSuccessAt: health.lastD1ReadbackSuccessAt || health.lastD1WriteSuccessAt || null,
      lastFailureAt: health.lastD1FailureAt || health.lastFailedCollectAt || health.lastFailedHarvestAt || null,
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
    const schema = await schemaVersion(env, { readOk });
    const build = buildMeta(context.request, env, schema);
    return json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        deploymentCommit: deploymentCommit(env),
        modelVersion: MODEL_VERSION,
        build,
        state: derived.state,
        d1: {
          bound: Boolean(health.bound),
          source: health.source || (health.bound ? "d1" : "unbound"),
          lastD1WriteSuccessAt: health.lastD1WriteSuccessAt || null,
          lastD1ReadbackSuccessAt: health.lastD1ReadbackSuccessAt || null,
          lastD1FailureAt: health.lastD1FailureAt || null,
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
        telemetry: {
          endpoint: "/api/health",
          requestCount: 1,
          queryCountEstimate: readOk ? 6 : 2,
          rowsReadEstimate: 1,
          cacheStatus: "max-age=15",
          lastQuotaFailure: readOk ? null : (health.lastError || health.source || null),
        },
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

function buildMeta(request, env, schema) {
  const host = new URL(request.url).hostname;
  const first = host.split(".")[0] || "";
  const deploymentIdFromHost = /^[a-f0-9]{8,}$/i.test(first) ? first : null;
  const branch = env.CF_PAGES_BRANCH || null;
  const environment = branch === "main" || host === "fbis-myz.pages.dev" ? "production" : "preview";
  return {
    commitSha: deploymentCommit(env),
    deploymentId: env.CF_PAGES_DEPLOYMENT_ID || deploymentIdFromHost || null,
    buildTimestamp: env.BUILD_TIMESTAMP || null,
    environment,
    branch,
    pagesUrl: env.CF_PAGES_URL || null,
    schemaVersion: schema.version,
    migrationStatus: schema.status,
    expectedMigration: EXPECTED_MIGRATION,
  };
}

async function schemaVersion(env, { readOk }) {
  if (!readOk || !env?.DB?.prepare) return { version: null, status: MIGRATION_STATUS.UNVERIFIED };
  try {
    const row = await env.DB.prepare("SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1").first();
    const check = await env.DB.prepare("SELECT id FROM schema_migrations WHERE id = ? LIMIT 1")
      .bind(EXPECTED_MIGRATION)
      .first();
    return {
      version: row?.id || null,
      status: check?.id ? MIGRATION_STATUS.VERIFIED : MIGRATION_STATUS.UNVERIFIED,
    };
  } catch (err) {
    const msg = String(err?.message || err);
    if (/not authorized|authentication|permission/i.test(msg)) {
      return { version: null, status: MIGRATION_STATUS.BLOCKED };
    }
    if (/no such table|no such column|syntax/i.test(msg)) {
      return { version: null, status: MIGRATION_STATUS.FAILED };
    }
    return {
      version: null,
      status: MIGRATION_STATUS.UNVERIFIED,
    };
  }
}
