import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";
import { productProjectionBoard } from "../lib/productProjection.js";
import { authorizeProductTier } from "../lib/productAccess.js";

const SPORTS = new Set(["mlb", "cfb", "cbb", "nfl"]);

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = String(url.searchParams.get("sport") || "mlb").toLowerCase();
  const tier = String(url.searchParams.get("tier") || "public").toLowerCase();
  if (!SPORTS.has(sport)) return json({ ok: false, error: "unsupported-sport" }, 400, 10);
  const access = authorizeProductTier(context.request, context.env, tier);
  if (!access.ok) return json({ ok: false, error: access.reason }, access.reason === "unsupported-tier" ? 400 : 403, 0);
  const rawDate = url.searchParams.get("date") || "";
  const window = sport === "cfb" || sport === "cbb" ? { maxPast: 7, maxFuture: 14 } : { maxPast: 2, maxFuture: 1 };
  const resolved = resolveSlateDate(rawDate, window);
  if (rawDate && !resolved.ok) return json({ ok: false, error: resolved.error }, 400, 10);
  const env = {
    PARLAY_API_KEY: context.env.PARLAY_API_KEY,
    THEODDS_API_KEY: context.env.THEODDS_API_KEY,
    BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
    CFBD_API_KEY: context.env.CFBD_API_KEY,
    CBBD_API_KEY: context.env.CBBD_API_KEY,
    DB: context.env.DB,
    caches: caches.default,
  };
  try {
    const slate = await buildSlate(sport, resolved.date, env);
    return json(productProjectionBoard(slate, { tier: access.tier }), 200, access.tier === "public" ? 60 : 15);
  } catch (err) {
    return json({ ok: false, error: "projection-board-unavailable", detail: String(err?.message || err) }, 502, 5);
  }
}

function json(data, status = 200, maxAge = 30) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge > 0 ? `public, max-age=${maxAge}` : "no-store",
      "access-control-allow-origin": "*",
      "vary": "x-fbis-pro-token",
    },
  });
}
