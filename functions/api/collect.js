import { collectBoards } from "../lib/projLedger.js";
import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { httpStatusForJob, parseJobTrigger, parseJobMode, newJobId, JOB_FAILED, JOB_SUCCESS } from "../lib/jobs.js";
import { setMeta, persistJobRun } from "../lib/store.js";

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
  const scheduledSlot = url.searchParams.get("scheduledSlot") || "";
  if (url.searchParams.get("verifyRecord") === "1") {
    const outcome = url.searchParams.get("verifyOutcome") || "unavailable";
    const expectedSha = url.searchParams.get("expectedSha") || "";
    const actualSha = url.searchParams.get("actualSha") || "";
    const reason = url.searchParams.get("reason") || "";
    const now = new Date().toISOString();
    const id = newJobId("deployment-verify");
    await persistJobRun(context.env, {
      id,
      jobType: "deployment-verify",
      triggerType: trigger,
      startedAt: now,
      completedAt: now,
      status: outcome === "match" ? JOB_SUCCESS : JOB_FAILED,
      sport: "all",
      datesJson: JSON.stringify([]),
      errorSummary: `outcome=${outcome} expected=${expectedSha} actual=${actualSha || "unavailable"} reason=${reason} runUrl=${runUrl}`,
      deploymentCommit: expectedSha || null,
    });
    await setMeta(context.env, "last_deployment_verify_outcome", outcome);
    await setMeta(context.env, "last_deployment_verify_expected_sha", expectedSha);
    await setMeta(context.env, "last_deployment_verify_actual_sha", actualSha || "unavailable");
    return new Response(
      JSON.stringify({
        ok: true,
        status: outcome === "match" ? JOB_SUCCESS : JOB_FAILED,
        job: "deployment-verify",
        trigger_type: trigger,
        outcome,
        expectedSha,
        actualSha: actualSha || null,
      }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }
    );
  }
  try {
    if (trigger === "schedule") {
      await setMeta(context.env, "last_scheduled_event_type", "schedule");
      if (runUrl) await setMeta(context.env, "last_scheduled_run_url", runUrl);
      if (scheduledSlot) await setMeta(context.env, "last_scheduled_slot", scheduledSlot);
      await setMeta(context.env, "last_scheduled_actual_start_at", new Date().toISOString());
    }
    const payload = await collectBoards(
      {
        PARLAY_API_KEY: context.env.PARLAY_API_KEY,
        THEODDS_API_KEY: context.env.THEODDS_API_KEY,
        BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
        CFBD_API_KEY: context.env.CFBD_API_KEY,
        CBBD_API_KEY: context.env.CBBD_API_KEY,
        caches: caches.default,
        DB: context.env.DB,
        CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
      },
      { odds: mode === "health" ? "cache" : odds, trigger, sport, dayOffset, mode }
    );
    return new Response(JSON.stringify(payload), {
      status: httpStatusForJob(payload.status),
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, status: "failed", error: String(err?.message || err) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
