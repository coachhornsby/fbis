import { buildTrackReport } from "../lib/projLedger.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = url.searchParams.get("sport") || "all";
  const days = url.searchParams.get("days") || "season";
  const checkpoint = url.searchParams.get("checkpoint") || "LATEST";
  const version = url.searchParams.get("version") || "all";
  const model = url.searchParams.get("model") || "ensemble";
  const type = url.searchParams.get("type") || "perGame";
  const year = url.searchParams.get("year") || "";
  const team = url.searchParams.get("team") || "";
  try {
    const payload = await buildTrackReport(
      sport,
      days,
      {
        PARLAY_API_KEY: context.env.PARLAY_API_KEY,
        BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
        caches: caches.default,
        DB: context.env.DB,
      },
      { checkpoint, version, model, type, year, team }
    );
    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60",
        "access-control-allow-origin": "*",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err), games: [], finals: [], accuracy: { n: 0 } }),
      {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }
}
