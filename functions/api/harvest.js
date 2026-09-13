import { harvestAll, backfillNflFormViaHarvest } from "../lib/projLedger.js";
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
  const settleOnly = url.searchParams.get("settleOnly") === "1";
  const gradeResearch = url.searchParams.get("gradeResearch") === "1";
  const sport = url.searchParams.get("sport") || "all";
  const formBackfill = url.searchParams.get("formBackfill") === "1";
  const formSeason = url.searchParams.get("formSeason");
  const formWeeks = url.searchParams.get("formWeeks");
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
    if (formBackfill) {
      const weeks = formWeeks
        ? formWeeks
            .split(",")
            .map((w) => Number(w.trim()))
            .filter((n) => Number.isFinite(n) && n > 0)
        : null;
      const payload = await backfillNflFormViaHarvest(
        {
          caches: caches.default,
          DB: context.env.DB,
          ARCHIVE: context.env.ARCHIVE,
          CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
        },
        {
          season: formSeason ? Number(formSeason) : undefined,
          weeks,
          includePostseason: url.searchParams.get("includePostseason") !== "0",
        }
      );
      return new Response(JSON.stringify({ ok: payload.ok !== false, job: "nfl-form-backfill", ...payload }), {
        status: payload.ok === false ? 502 : 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
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
      { trigger, sport, date, settleOnly, gradeResearch }
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
