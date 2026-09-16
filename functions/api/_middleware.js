import { authorizeOperatorWrite, authorizeExecutedBetWrite, unauthorizedBody } from "../lib/auth.js";
import { evaluateActionSpendGuard } from "../lib/actionCostPolicy.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function utcPeriodStarts(now = new Date()) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return { dayStart, monthStart };
}

async function loadActionSpendState(env, { sport, profile, lifecycle, now = new Date() }) {
  if (!env?.DB) throw new Error("D1 unavailable for ACTION spend guard");
  const { dayStart, monthStart } = utcPeriodStarts(now);

  const month = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END), 0) AS usd
     FROM shadow_cost_ledger
     WHERE created_at >= ?`
  ).bind(monthStart).first();

  const day = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END), 0) AS usd
     FROM shadow_cost_ledger
     WHERE created_at >= ?`
  ).bind(dayStart).first();

  const runs = await env.DB.prepare(
    `SELECT COUNT(*) AS n
     FROM shadow_collection_runs
     WHERE started_at >= ? AND status LIKE 'success%'`
  ).bind(dayStart).first();

  const last = await env.DB.prepare(
    `SELECT finished_at
     FROM shadow_collection_runs
     WHERE sport = ? AND profile = ? AND lifecycle = ? AND status LIKE 'success%'
     ORDER BY finished_at DESC
     LIMIT 1`
  ).bind(
    String(sport || "").toLowerCase(),
    String(profile || "BASE").toUpperCase(),
    String(lifecycle || "pregame").toLowerCase(),
  ).first();

  return {
    monthToDateUsd: Number(month?.usd || 0),
    dayToDateUsd: Number(day?.usd || 0),
    successfulRunsToday: Number(runs?.n || 0),
    lastSuccessAt: last?.finished_at || null,
    dayStart,
    monthStart,
  };
}

async function guardActionCollection(context, request, url) {
  if (String(request.method || "GET").toUpperCase() !== "POST") return null;
  if (url.pathname !== "/api/action-apify-collect") return null;

  let body = {};
  try {
    body = await request.clone().json();
  } catch {
    body = {};
  }

  const execute = String(url.searchParams.get("execute") || body.execute || "") === "1";
  if (!execute) return null;

  const sport = String(body.sport || url.searchParams.get("sport") || "cfb").toLowerCase();
  const lifecycle = String(body.lifecycle || url.searchParams.get("lifecycle") || "pregame").toLowerCase();
  const profile = String(body.profile || url.searchParams.get("profile") || "BASE").toUpperCase();
  const maxItemsRaw = body.maxItems ?? url.searchParams.get("maxItems");
  const maxItems = Number.isFinite(Number(maxItemsRaw)) && Number(maxItemsRaw) > 0
    ? Number(maxItemsRaw)
    : 20;

  try {
    const state = await loadActionSpendState(context.env, { sport, profile, lifecycle });
    const guard = evaluateActionSpendGuard({
      ...state,
      profile,
      lifecycle,
      maxItems,
      env: context.env,
    });

    if (!guard.allowed) {
      return json({
        ok: true,
        executed: false,
        status: "cost_throttled",
        reason: guard.blocks[0]?.message || "ACTION collection throttled",
        blocks: guard.blocks,
        sport,
        lifecycle,
        profile,
        budget: {
          monthToDateUsd: guard.monthToDateUsd,
          dayToDateUsd: guard.dayToDateUsd,
          monthlyBudgetUsd: guard.policy.monthlyBudgetUsd,
          dailyBudgetUsd: guard.policy.dailyBudgetUsd,
          profileDailyCeilingUsd: guard.profileDailyCeilingUsd,
          estimatedNextRunUsd: guard.estimatedNextRunUsd,
          successfulRunsToday: guard.successfulRunsToday,
          maxSuccessfulRunsPerDay: guard.policy.maxSuccessfulRunsPerDay,
          cooldownMinutes: guard.cooldownMinutes,
        },
        inProductionRouter: false,
        canQualify: false,
        canAuthorizeWager: false,
        affectsProductionOdds: false,
      });
    }
  } catch (err) {
    // Spend control fails closed: a telemetry/storage problem must never trigger paid collection.
    return json({
      ok: true,
      executed: false,
      status: "cost_guard_unavailable",
      reason: "ACTION paid collection blocked because spend guard state could not be verified",
      error: String(err?.message || err),
      sport,
      lifecycle,
      profile,
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
      affectsProductionOdds: false,
    });
  }

  return null;
}

/**
 * API write-surface guard.
 *
 * Read endpoints remain public.
 * - Board operator actions (manual-final) allow same-origin, like Heritage import.
 * - Destructive research mutations on /api/track still require the strategy/harvest secret.
 * - Paid ACTION collection is D1-first and hard-throttled before the Actor can launch.
 */
export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const method = String(request.method || "GET").toUpperCase();

  const actionGuardResponse = await guardActionCollection(context, request, url);
  if (actionGuardResponse) return actionGuardResponse;

  if (method === "POST" && url.pathname === "/api/track") {
    let action = "";
    try {
      const cloned = request.clone();
      const body = await cloned.json();
      action = String(body?.action || "").toLowerCase();
    } catch {
      action = "";
    }
    const auth =
      action === "manual-final"
        ? authorizeExecutedBetWrite(request, context.env)
        : authorizeOperatorWrite(request, context.env);
    if (!auth.ok) {
      return new Response(JSON.stringify(unauthorizedBody(auth.reason || "unauthorized")), {
        status: 401,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
  }

  return context.next();
}