import { collectBoards } from "../lib/projLedger.js";

/** Pregame collection. Builds every board and freezes checkpoints. Does not require the browser. */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const secret = context.env.HARVEST_SECRET;
  if (secret) {
    const got = url.searchParams.get("secret") || context.request.headers.get("x-harvest-secret");
    if (got !== secret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  }
  const odds = url.searchParams.get("odds") === "full" ? "full" : "cache";
  try {
    const payload = await collectBoards(
      {
        PARLAY_API_KEY: context.env.PARLAY_API_KEY,
        BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
        caches: caches.default,
        DB: context.env.DB,
      },
      { odds }
    );
    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
