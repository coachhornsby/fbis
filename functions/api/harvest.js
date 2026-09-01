import { harvestAll } from "../lib/projLedger.js";
import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { deploymentCommit, httpStatusForJob, parseJobTrigger, pipelineStageId } from "../lib/jobs.js";
import { persistPipelineStage, setMeta } from "../lib/store.js";

/** Scoreboard-only harvest. Never calls Parlay. */
export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) {
    return new Response(JSON.stringify(unauthorizedBody()), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const url = new URL(context.request.url);
  const days = url.searchParams.get("days") || "3";
  const sport = url.searchParams.get("sport") || "all";
  const trigger = parseJobTrigger(context.request);
  const runUrl = url.searchParams.get("runUrl") || "";
  const stage = { id: pipelineStageId({ stage: "harvest", sport, runUrl, scope: `days-${days}` }), runUrl, stage: "harvest", sport, triggerType: trigger, status: "running", startedAt: new Date().toISOString(), deploymentCommit: deploymentCommit(context.env) };
  try {
    await persistPipelineStage(context.env, stage);
    if (trigger === "schedule") {
      await setMeta(context.env, "last_scheduled_event_type", "schedule");
      if (runUrl) await setMeta(context.env, "last_scheduled_run_url", runUrl);
    }
    const payload = await harvestAll(
      days,
      {
        caches: caches.default,
        DB: context.env.DB,
        CFBD_API_KEY: context.env.CFBD_API_KEY,
        CBBD_API_KEY: context.env.CBBD_API_KEY,
        CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
      },
      { trigger, sport }
    );
    const errors = payload.errors || [];
    const stageStatus = payload.status === "success" && errors.length ? "degraded" : payload.status;
    await persistPipelineStage(context.env, { ...stage, status: stageStatus, completedAt: new Date().toISOString(), httpStatus: httpStatusForJob(payload.status), errorSummary: errors.slice(0, 4).join(" | ") || null });
    return new Response(JSON.stringify(payload), {
      status: httpStatusForJob(payload.status),
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    await persistPipelineStage(context.env, { ...stage, status: "failed", completedAt: new Date().toISOString(), httpStatus: 502, errorSummary: String(err?.message || err) });
    return new Response(JSON.stringify({ ok: false, status: "failed", error: String(err?.message || err) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
