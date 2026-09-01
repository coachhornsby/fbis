import { deploymentCommit, durableHealth, scheduledHealth } from "../lib/jobs.js";
import { pingDb, queryPipelineStages } from "../lib/store.js";

export async function buildHealth(env, now = new Date()) {
  const db = await pingDb(env);
  const durable = db.ok ? await durableHealth(env) : { bound: false, source: "unavailable" };
  const stages = db.ok ? await queryPipelineStages(env, { limit: 10 }) : [];
  return {
    ok: Boolean(db.ok),
    service: "fbis",
    checked_at: now.toISOString(),
    deployment_commit: deploymentCommit(env),
    d1: { bound: Boolean(db.bound), ok: Boolean(db.ok), reason: db.reason || null },
    schedule: scheduledHealth(durable, now),
    latest: {
      collect: {
        success_at: durable.lastCollectSuccessAt || null,
        attempt_at: durable.lastCollectAttemptAt || null,
      },
      harvest: {
        success_at: durable.lastHarvestSuccessAt || null,
        attempt_at: durable.lastHarvestAttemptAt || null,
      },
      job: durable.lastJob || null,
    },
    stages,
  };
}

export async function onRequestGet(context) {
  try {
    const body = await buildHealth({
      DB: context.env.DB,
      CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
      CF_PAGES_COMMIT: context.env.CF_PAGES_COMMIT,
    });
    return json(body, body.ok ? 200 : 503);
  } catch (err) {
    return json({ ok: false, service: "fbis", error: String(err?.message || err) }, 503);
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
