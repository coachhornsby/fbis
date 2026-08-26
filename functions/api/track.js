import { buildTrackReport } from "../lib/projLedger.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = url.searchParams.get("sport") || "all";
  const days = url.searchParams.get("days") || "8";
  try {
    const payload = await buildTrackReport(sport, days, {
      PARLAY_API_KEY: context.env.PARLAY_API_KEY,
      BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
      caches: caches.default,
    });
    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60",
        "access-control-allow-origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err), games: [], finals: [], accuracy: { n: 0 } }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
