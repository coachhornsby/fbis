import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";
import { freezeSlate, harvestSport } from "../lib/projLedger.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = url.searchParams.get("sport") || "mlb";
  const rawDate = url.searchParams.get("date") || "";
  const resolved = resolveSlateDate(rawDate);
  if (rawDate && !resolved.ok) {
    return json({ error: resolved.error, games: [], ticker: [], counts: {} }, 400, 10);
  }
  const env = {
    PARLAY_API_KEY: context.env.PARLAY_API_KEY,
    BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
    caches: caches.default,
    DB: context.env.DB,
  };
  try {
    const payload = await buildSlate(sport, resolved.date, env);
    context.waitUntil(
      freezeSlate(payload, env).catch((err) => {
        console.error("freezeSlate", err?.message || err);
      })
    );
    context.waitUntil(
      harvestSport(payload.sport, 2, env).catch((err) => {
        console.error("harvestSport", err?.message || err);
      })
    );
    return json(payload, 200, 30);
  } catch (err) {
    return json({ error: String(err?.message || err), games: [], ticker: [], counts: {} }, 502, 10);
  }
}

function json(data, status, maxAge) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      "access-control-allow-origin": "*",
    },
  });
}
