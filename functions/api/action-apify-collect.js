/**
 * Scheduled Action/Apify candidate collection endpoint.
 *
 * Shadow / production-candidate only.
 * Never mutates ODDS_PROVIDER_ORDER.
 * Never grants canQualify / canAuthorizeWager.
 * Failure here must not fail incumbent collect/harvest.
 */

import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { parseJobTrigger } from "../lib/jobs.js";
import {
  planCandidateCollection,
  evaluateSchedulerSafety,
  runCandidateCollection,
  actionApifyCandidateHealth,
} from "../lib/actionApifyCollector.js";
import {
  evaluateCandidatePromotionPackage,
  projectMonthlyStarterSufficiency,
} from "../lib/actionApifyChampionship.js";
import { assertActionApifyNotInProductionRouter } from "../lib/actionApifyShadow.js";
import { ODDS_PROVIDER_ORDER } from "../lib/oddsProviderRouter.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * GET — dry-run plan / health / monthly model (no Actor network by default).
 * Query:
 *   sport=cfb|nfl|mlb
 *   lifecycle=early_slate|pregame|final_pregame|postgame
 *   profile=BASE|MOVEMENT|MLB_F5|PLAYER_PROPS|FINAL
 *   mode=plan|health|monthly|scorecard
 */
export async function onRequestGet(context) {
  assertActionApifyNotInProductionRouter(ODDS_PROVIDER_ORDER);
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);

  const url = new URL(context.request.url);
  const mode = String(url.searchParams.get("mode") || "plan").toLowerCase();
  const sport = String(url.searchParams.get("sport") || "cfb").toLowerCase();
  const lifecycle = String(url.searchParams.get("lifecycle") || "pregame").toLowerCase();
  const profile = url.searchParams.get("profile") || undefined;

  if (mode === "health") {
    return json({
      ok: true,
      job: "action-apify-candidate",
      mode: "shadow",
      actionApify: actionApifyCandidateHealth(context.env),
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
    });
  }

  if (mode === "monthly") {
    return json({
      ok: true,
      job: "action-apify-candidate",
      mode: "shadow",
      monthly: projectMonthlyStarterSufficiency({}),
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
    });
  }

  if (mode === "scorecard") {
    const pkg = evaluateCandidatePromotionPackage({
      actionRows: [],
      incumbents: {},
      sampleRuns: 0,
      plan: String(context.env.ACTION_APIFY_PLAN || "free"),
    });
    return json({
      ok: true,
      job: "action-apify-candidate",
      mode: "shadow",
      package: pkg,
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
    });
  }

  const plan = planCandidateCollection(context.env, { sport, lifecycle, profile });
  const safety = evaluateSchedulerSafety(plan);
  return json({
    ok: true,
    job: "action-apify-candidate",
    mode: "shadow",
    trigger: parseJobTrigger(context.request),
    plan: {
      sport: plan.sport,
      lifecycle: plan.lifecycle,
      profile: plan.profile,
      temporalClass: plan.temporalClass,
      freePlan: plan.freePlan,
      estimatedCostUsd: plan.estimatedCostUsd,
      input: plan.input,
      cfg: {
        enabled: plan.cfg.enabled,
        plan: plan.cfg.plan,
        configured: plan.cfg.configured,
        maxItems: plan.cfg.maxItems,
        monthlyBudgetUsd: plan.cfg.monthlyBudgetUsd,
      },
    },
    safety,
    inProductionRouter: false,
    canQualify: false,
    canAuthorizeWager: false,
    note: "GET is plan/dry-run only. POST execute=1 to run candidate collection.",
  });
}

/**
 * POST — execute candidate collection when enabled.
 * Body/query:
 *   sport, lifecycle, profile, date
 *   execute=1 required to hit Apify
 * Never spends in CI; offline callers may inject rows via test harness only.
 */
export async function onRequestPost(context) {
  assertActionApifyNotInProductionRouter(ODDS_PROVIDER_ORDER);
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);

  const url = new URL(context.request.url);
  let body = {};
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }

  const execute = String(url.searchParams.get("execute") || body.execute || "") === "1";
  const sport = String(body.sport || url.searchParams.get("sport") || "cfb").toLowerCase();
  const lifecycle = String(body.lifecycle || url.searchParams.get("lifecycle") || "pregame").toLowerCase();
  const profile = body.profile || url.searchParams.get("profile") || undefined;
  const date = body.date || url.searchParams.get("date") || undefined;

  if (!execute) {
    const plan = planCandidateCollection(context.env, { sport, lifecycle, profile, date });
    const safety = evaluateSchedulerSafety(plan);
    return json({
      ok: true,
      executed: false,
      reason: "execute=1 required for live candidate run",
      plan: {
        sport: plan.sport,
        profile: plan.profile,
        estimatedCostUsd: plan.estimatedCostUsd,
        input: plan.input,
      },
      safety,
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
    });
  }

  try {
    const result = await runCandidateCollection(context.env, {
      sport,
      lifecycle,
      profile,
      date,
      db: context.env.DB
        ? {
            exec: async (sql, params = []) => context.env.DB.prepare(sql).bind(...params).run(),
            getObservationKey: async (naturalKey) => {
              const row = await context.env.DB.prepare(
                "SELECT * FROM shadow_observation_keys WHERE natural_key = ?"
              )
                .bind(naturalKey)
                .first();
              return row || null;
            },
            putObservationKey: async (row) => {
              await context.env.DB.prepare(
                `INSERT OR REPLACE INTO shadow_observation_keys (
                  natural_key, observation_id, run_id, provider, action_game_id, market, period, book,
                  source_observed_at, collected_at, payload_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
                .bind(
                  row.natural_key,
                  row.observation_id,
                  row.run_id,
                  row.provider,
                  row.action_game_id,
                  row.market,
                  row.period,
                  row.book,
                  row.source_observed_at,
                  row.collected_at,
                  row.payload_hash,
                  row.created_at
                )
                .run();
            },
          }
        : null,
    });

    // Strip any accidental secret material; never return token.
    const safe = {
      ...result,
      rows: undefined,
      token: undefined,
      authorization: undefined,
    };
    return json({
      ...safe,
      executed: true,
      trigger: parseJobTrigger(context.request),
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
      actionApify: actionApifyCandidateHealth(context.env),
    }, result.ok ? 200 : 502);
  } catch (err) {
    return json({
      ok: false,
      executed: true,
      error: String(err?.message || err),
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
      affectsProductionOdds: false,
    }, 502);
  }
}
