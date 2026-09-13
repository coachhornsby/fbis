import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildModelLabReport } from "../lib/modelLab.js";
import {
  buildModelRegistryReport,
  listModels,
  autoPromoteAllowed,
} from "../lib/canonical/index.js";

const ALLOWED_SPORTS = new Set(["cbb", "cfb", "nfl", "mlb", "nba", "nhl", "all"]);

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = String(url.searchParams.get("sport") || "cbb").toLowerCase();
  const registryOnly = url.searchParams.get("registryOnly") === "true";
  if (!ALLOWED_SPORTS.has(sport)) {
    return new Response(JSON.stringify({ ok: false, error: "unsupported-sport", allowed: [...ALLOWED_SPORTS] }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  try {
    const registry = buildModelRegistryReport();
    const registered = listModels(sport === "all" ? {} : { sport });
    const governance = {
      autoPromoteAllowed: autoPromoteAllowed(),
      actionShadowOnly: true,
      registeredModels: registered,
      registrySummary: {
        count: registry.count,
        champions: registry.champions,
      },
    };

    // Public read-only registry (no secrets). Metrics lab stays harvest-gated.
    if (sport === "nba" || sport === "nhl" || sport === "all" || registryOnly) {
      return new Response(
        JSON.stringify({
          ok: true,
          sport,
          generatedAt: new Date().toISOString(),
          mode: "registry",
          governance,
          note: "Metrics lab remains sport-scoped and harvest-gated; registry is the governance source of truth.",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        }
      );
    }

    const auth = authorizeHarvest(context.request, context.env);
    if (!auth.ok) {
      return new Response(JSON.stringify(unauthorizedBody()), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    const payload = await buildModelLabReport(context.env, {
      sport,
      championModelId: url.searchParams.get("champion") || null,
      limit: url.searchParams.get("limit") || 5000,
      includeMarketInformed: url.searchParams.get("includeMarket") === "true",
    });
    return new Response(JSON.stringify({ ...payload, governance }), {
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
