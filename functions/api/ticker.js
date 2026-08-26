import { buildSlate } from "../lib/slateEngine.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = url.searchParams.get("sport") || "mlb";
  try {
    const payload = await buildSlate(sport, url.searchParams.get("date") || "", {
      PARLAY_API_KEY: context.env.PARLAY_API_KEY,
      BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
      caches: caches.default,
    });
    return new Response(JSON.stringify({ items: payload.ticker, generatedAt: payload.generatedAt }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=20",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ items: [], error: String(err?.message || err) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
