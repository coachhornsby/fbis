import { collectBoards } from "../lib/projLedger.js";
import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { deploymentCommit, httpStatusForJob, parseJobTrigger, parseJobMode } from "../lib/jobs.js";
import { persistPipelineStage, setMeta } from "../lib/store.js";

/** Pregame collection. Builds every board and freezes checkpoints. Does not require the browser. */
export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) {
    return new Response(JSON.stringify(unauthorizedBody()), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const url = new URL(context.request.url);
  const odds = url.searchParams.get("odds") === "full" ? "full" : "cache";
  const sport = url.searchParams.get("sport") || "all";
  const dayOffsetRaw = url.searchParams.get("dayOffset");
  const dayOffset = dayOffsetRaw == null || dayOffsetRaw === "" ? null : Number(dayOffsetRaw);
  const trigger = parseJobTrigger(context.request);
  const mode = parseJobMode(context.request);
  const runUrl = url.searchParams.get("runUrl") || "";
  const stage = { id: `collect:${sport}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, runUrl, stage: "collect", sport, triggerType: trigger, status: "running", startedAt: new Date().toISOString(), deploymentCommit: deploymentCommit(context.env) };
  try {
    await persistPipelineStage(context.env, stage);
    if (trigger === "schedule") {
      await setMeta(context.env, "last_scheduled_event_type", "schedule");
      if (runUrl) await setMeta(context.env, "last_scheduled_run_url", runUrl);
    }
    const payload = await collectBoards(
      {
        PARLAY_API_KEY: context.env.PARLAY_API_KEY,
        BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
        CFBD_API_KEY: context.env.CFBD_API_KEY,
        CBBD_API_KEY: context.env.CBBD_API_KEY,
        caches: caches.default,
        DB: context.env.DB,
        CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
      },
      { odds: mode === "health" ? "cache" : odds, trigger, sport, dayOffset, mode }
    );
    await persistPipelineStage(context.env, { ...stage, status: payload.status, completedAt: new Date().toISOString(), httpStatus: httpStatusForJob(payload.status), errorSummary: (payload.errors || []).slice(0, 4).join(" | ") || null });
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
