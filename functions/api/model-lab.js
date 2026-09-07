import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildModelLabReport } from "../lib/modelLab.js";

const ALLOWED_SPORTS = new Set(["cbb", "cfb", "nfl", "mlb"]);

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) {
    return new Response(JSON.stringify(unauthorizedBody()), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const url = new URL(context.request.url);
  const sport = String(url.searchParams.get("sport") || "cbb").toLowerCase();
  if (!ALLOWED_SPORTS.has(sport)) {
    return new Response(JSON.stringify({ ok: false, error: "unsupported-sport", allowed: [...ALLOWED_SPORTS] }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  try {
    const payload = await buildModelLabReport(context.env, {
      sport,
      championModelId: url.searchParams.get("champion") || null,
      limit: url.searchParams.get("limit") || 5000,
      includeMarketInformed: url.searchParams.get("includeMarket") === "true",
    });
    return new Response(JSON.stringify(payload), {
      status: payload.ok ? 200 : 400,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
