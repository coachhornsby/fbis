import { collectBoards } from "../lib/projLedger.js";
import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { deploymentCommit, httpStatusForJob, parseJobTrigger } from "../lib/jobs.js";
import { readMeta, setMeta } from "../lib/store.js";
import { lastExpectedCollectUtc } from "../lib/pipelineSchedule.js";

const SPORTS = new Set(["mlb", "nba", "wnba", "nhl", "nfl", "cfb", "cbb", "soccer"]);
const json = (body, status) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

// Bounded current-day cache collection. Reuse the canonical collector and its
// immutable-write/authority rules. The separate bulk CBB directory refresh is
// deliberately outside this response: it can exhaust CPU after collection has
// already persisted successfully. Its existing acquisition paths are unchanged.
export async function collectCurrentPipeline(context, collect = collectBoards) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);
  const url = new URL(context.request.url);
  const sport = url.searchParams.get("sport");
  const trigger = parseJobTrigger(context.request);
  if (trigger !== "schedule") return json({ ok: false, error: "Current scheduled trigger required" }, 400);
  const expected = url.searchParams.get("expectedSha");
  if (!/^[0-9a-f]{40}$/i.test(expected || "") || expected !== deploymentCommit(context.env)) {
    return json({ ok: false, error: "Production SHA changed or unavailable; writes blocked" }, 409);
  }
  try {
    if (url.searchParams.get("status") === "1") {
      if (!context.env.DB) return json({ ok: false, error: "D1 unavailable" }, 503);
      const meta = await readMeta(context.env);
      const expectedAt = Date.parse(lastExpectedCollectUtc());
      const stamps = [...SPORTS].map(s => [s, meta[`native_current_collect_success:${s}`]]);
      const missingSports = stamps.filter(([, at]) => !(Date.parse(at) >= expectedAt)).map(([s]) => s);
      return json({ ok: true, status: "success", missingSports,
        initializing: stamps.some(([, at]) => !at),
        inProgress: stamps.some(([, at]) => Date.parse(at) >= expectedAt) && missingSports.length > 0 }, 200);
    }
    if (!SPORTS.has(sport)) return json({ ok: false, error: "Current scheduled sport required" }, 400);
    await setMeta(context.env, "last_scheduled_event_type", trigger);
    await setMeta(context.env, "last_scheduled_run_url", url.searchParams.get("runUrl") || "");
    await setMeta(context.env, "last_scheduled_slot", url.searchParams.get("scheduledSlot") || "");
    await setMeta(context.env, "last_scheduled_actual_start_at", new Date().toISOString());
    await setMeta(context.env, "last_scheduled_collect_mode", "collect-cache");
    await setMeta(context.env, "last_scheduled_collect_sport", sport);
    await setMeta(context.env, "last_scheduled_collect_deployment_commit", expected);
    const payload = await collect({
      PARLAY_API_KEY: context.env.PARLAY_API_KEY,
      THEODDS_API_KEY: context.env.THEODDS_API_KEY,
      SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
      THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
      BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
      CFBD_API_KEY: context.env.CFBD_API_KEY,
      CBBD_API_KEY: context.env.CBBD_API_KEY,
      caches: globalThis.caches?.default,
      DB: context.env.DB,
      CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
    }, {
      odds: "cache", trigger, sport, dayOffset: 0,
    });
    if (payload.ok === true && payload.status === "success") {
      await setMeta(context.env, `native_current_collect_success:${sport}`, new Date().toISOString());
    }
    return json(payload, httpStatusForJob(payload.status));
  } catch (error) {
    return json({ ok: false, status: "failed", error: String(error.message || error) }, 502);
  }
}

export const onRequestGet = (context) => collectCurrentPipeline(context);
