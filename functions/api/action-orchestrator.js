import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { queryGames } from "../lib/store.js";
import { loadFbisSlateForMatching } from "../lib/actionApifyEvidence.js";
import { ACTION_ORCHESTRATOR_SPORTS, buildActionOrchestrationPlan } from "../lib/actionOrchestration.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function loadHistory(env, sinceIso) {
  if (!env?.DB) return [];
  try {
    const res = await env.DB.prepare(
      `SELECT sport, profile, lifecycle, status, started_at, finished_at
       FROM shadow_collection_runs
       WHERE started_at >= ?
       ORDER BY started_at DESC
       LIMIT 250`
    ).bind(sinceIso).all();
    return res?.results || [];
  } catch {
    return [];
  }
}

/**
 * Read-only orchestration planner. It never launches Apify.
 * The GitHub scheduler consumes this plan and submits only the prioritized jobs
 * through /api/action-apify-collect, where the hard spend guard remains authoritative.
 */
export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);

  const now = new Date();
  const slates = {};
  const slateMeta = {};
  for (const sport of ACTION_ORCHESTRATOR_SPORTS) {
    const slate = await loadFbisSlateForMatching(queryGames, context.env, { sport, now });
    slates[sport] = slate.fbisEvents || [];
    slateMeta[sport] = {
      gamesExpected: slate.gamesExpected,
      slateError: slate.slateError || null,
      slateDates: slate.slateDates || [],
    };
  }

  const history = await loadHistory(context.env, new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString());
  const plan = buildActionOrchestrationPlan({ slates, history, now });

  return json({
    ok: true,
    ...plan,
    slateMeta,
    paidExecution: false,
    executionEndpoint: "/api/action-apify-collect",
    note: "Planner only. Paid collection is separately guarded and never runs from board/API reads.",
  });
}

export async function onRequestPost(context) {
  return onRequestGet(context);
}
