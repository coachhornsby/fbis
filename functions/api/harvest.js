import { harvestAll } from "../lib/projLedger.js";
import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { httpStatusForJob, parseJobTrigger } from "../lib/jobs.js";
import { setMeta } from "../lib/store.js";

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
  const date = url.searchParams.get("date") || "";
  const sport = url.searchParams.get("sport") || "all";
  const trigger = parseJobTrigger(context.request);
  const runUrl = url.searchParams.get("runUrl") || "";
  const scheduledSlot = url.searchParams.get("scheduledSlot") || "";
  try {
    if (trigger === "schedule") {
      await setMeta(context.env, "last_scheduled_event_type", "schedule");
      if (runUrl) await setMeta(context.env, "last_scheduled_run_url", runUrl);
      if (scheduledSlot) await setMeta(context.env, "last_scheduled_slot", scheduledSlot);
      await setMeta(context.env, "last_scheduled_actual_start_at", new Date().toISOString());
    }
    const payload = await harvestAll(
      days,
      {
        caches: caches.default,
        DB: context.env.DB,
        ARCHIVE: context.env.ARCHIVE,
        CFBD_API_KEY: context.env.CFBD_API_KEY,
        CBBD_API_KEY: context.env.CBBD_API_KEY,
        CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
      },
      { trigger, sport, date }
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
