import { collectBoards } from "../lib/projLedger.js";
import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { httpStatusForJob } from "../lib/jobs.js";

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
  try {
    const payload = await collectBoards(
      {
        PARLAY_API_KEY: context.env.PARLAY_API_KEY,
        BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
        caches: caches.default,
        DB: context.env.DB,
        CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
      },
      { odds, trigger: "http", sport }
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
