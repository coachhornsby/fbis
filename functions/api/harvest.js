import { harvestAll } from "../lib/projLedger.js";

/** Scoreboard-only harvest. Never calls Parlay. */
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
  const days = url.searchParams.get("days") || "3";
  try {
    const payload = await harvestAll(days, {
      caches: caches.default,
      DB: context.env.DB,
    });
    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60",
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
