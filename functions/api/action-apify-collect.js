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
import { projectMonthlyStarterSufficiency } from "../lib/actionApifyChampionship.js";
import { assertActionApifyNotInProductionRouter } from "../lib/actionApifyShadow.js";
import { ODDS_PROVIDER_ORDER } from "../lib/oddsProviderRouter.js";
import { queryGames } from "../lib/store.js";
import {
  loadDurableCandidateHealth,
  loadPersistedChampionshipScorecard,
  loadFbisSlateForMatching,
} from "../lib/actionApifyEvidence.js";
import { queryMonthToDateSpendUsd } from "../lib/actionApifyDurableState.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function createCandidateDb(env) {
  if (!env?.DB) return null;
  return {
    exec: async (sql, params = []) => env.DB.prepare(sql).bind(...params).run(),
    batch: async (statements = []) => {
      if (!statements.length) return [];
      return env.DB.batch(
        statements.map(({ sql, params = [] }) => env.DB.prepare(sql).bind(...params))
      );
    },
    queryOne: async (sql, params = []) => {
      const row = await env.DB.prepare(sql).bind(...params).first();
      return row || null;
    },
    queryAll: async (sql, params = []) => {
      const res = await env.DB.prepare(sql).bind(...params).all();
      return res?.results || [];
    },
    getObservationKey: async (naturalKey) => {
      const row = await env.DB.prepare(
        "SELECT * FROM shadow_observation_keys WHERE natural_key = ?"
      )
        .bind(naturalKey)
        .first();
      return row || null;
    },
    putObservationKey: async (row) => {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO shadow_observation_keys (
          natural_key, observation_id, run_id, provider, action_game_id, market, period, book,
          source_observed_at, collected_at, payload_hash, created_at,
          run_idempotency_key, sampling_kind, fbis_event_id, line, price
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          row.created_at,
          row.run_idempotency_key || null,
          row.sampling_kind || null,
          row.fbis_event_id || null,
          row.line ?? null,
          row.price ?? null
        )
        .run();
    },
  };
}

async function loadFbisSlate(env, { sport, date }) {
  return loadFbisSlateForMatching(queryGames, env, { sport, date });
}

function emptySlateResponse({ sport, lifecycle, profile, slate, trigger }) {
  return {
    ok: true,
    executed: false,
    status: "skipped_no_slate",
    reason: "no active FBIS games in the ACTION matching window",
    sport,
    lifecycle,
    profile: profile || "BASE",
    expectedSlateGames: 0,
    slateError: slate?.slateError || null,
    slateDates: slate?.slateDates || null,
    trigger,
    inProductionRouter: false,
    canQualify: false,
    canAuthorizeWager: false,
    affectsProductionOdds: false,
  };
}

/**
 * GET — dry-run plan / health / monthly / scorecard (no Actor spend by default).
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
  const date = url.searchParams.get("date") || undefined;
  const window = url.searchParams.get("window") || "7d";
  const db = createCandidateDb(context.env);

  if (mode === "health") {
    const durable = await loadDurableCandidateHealth(context.env, db, {
      sport,
      profile: profile || "BASE",
      lifecycle,
    });
    return json({
      ok: true,
      job: "action-apify-candidate",
      mode: "shadow",
      actionApify: durable,
      // Cold-request proof: durable metrics do not require warm isolate memory.
      ephemeralFallback: actionApifyCandidateHealth(context.env),
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
      affectsProductionOdds: false,
    });
  }

  if (mode === "observations") {
    const limitRaw = Number(url.searchParams.get("limit") || 1000);
    const limit = Math.max(1, Math.min(5000, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 1000));
    const dateFilter = date ? String(date).slice(0, 10) : null;
    if (!db?.queryAll) {
      return json({ ok: false, error: "D1 unavailable", sport, observations: [], books: [], splits: [], lineMovement: [] }, 503);
    }
    const obsParams = [sport];
    let obsWhere = "LOWER(COALESCE(league, '')) = LOWER(?)";
    if (sport === "mlb") obsWhere = "(LOWER(COALESCE(league, '')) IN ('mlb','baseball') OR LOWER(COALESCE(league, '')) = LOWER(?))";
    if (dateFilter) {
      obsWhere += " AND substr(COALESCE(start_time, created_at),1,10) = ?";
      obsParams.push(dateFilter);
    }
    const observations = await db.queryAll(
      "SELECT * FROM shadow_market_observations WHERE " + obsWhere + " ORDER BY created_at DESC LIMIT " + limit,
      obsParams
    );
    const ids = observations.map((row) => row.id).filter(Boolean);
    let books = [], splits = [], lineMovement = [], bookObservations = [];
    if (ids.length) {
      const qs = ids.map(() => "?").join(",");
      books = await db.queryAll("SELECT * FROM shadow_market_books WHERE observation_id IN (" + qs + ") ORDER BY created_at DESC", ids);
      splits = await db.queryAll("SELECT * FROM shadow_market_splits WHERE observation_id IN (" + qs + ") ORDER BY created_at DESC", ids);
      lineMovement = await db.queryAll("SELECT * FROM shadow_line_movement WHERE observation_id IN (" + qs + ") ORDER BY created_at DESC", ids);
      try {
        const providerIds = [...new Set(observations.map((row) => row.action_game_id).filter(Boolean))];
        if (providerIds.length) {
          const pqs = providerIds.map(() => "?").join(",");
          bookObservations = await db.queryAll(
            "SELECT * FROM action_market_book_observations WHERE sport = ? AND provider_event_id IN (" + pqs + ") ORDER BY collected_at DESC LIMIT " + limit,
            [sport, ...providerIds]
          );
        }
      } catch {
        bookObservations = [];
      }
    }
    return json({
      ok: true,
      mode: "observations",
      sport,
      date: dateFilter,
      count: { observations: observations.length, books: books.length, splits: splits.length, lineMovement: lineMovement.length, bookObservations: bookObservations.length },
      observations,
      books,
      splits,
      lineMovement,
      bookObservations,
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
      affectsProductionOdds: false,
    });
  }

  if (mode === "monthly") {
    const mtd = await queryMonthToDateSpendUsd(db);
    return json({
      ok: true,
      job: "action-apify-candidate",
      mode: "shadow",
      monthly: projectMonthlyStarterSufficiency({}),
      monthToDateCostUsd: mtd.mtdUsd,
      monthStart: mtd.monthStart,
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
    });
  }

  if (mode === "scorecard") {
    const pkg = await loadPersistedChampionshipScorecard(db, {
      window,
      sport: url.searchParams.get("sport") || null,
      plan: String(context.env.ACTION_APIFY_PLAN || "free"),
    });
    return json({
      ok: true,
      job: "action-apify-candidate",
      mode: "shadow",
      evidenceBasis: pkg.evidenceBasis,
      package: pkg,
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
      autoPromotion: false,
    });
  }

  const maxItemsRaw = url.searchParams.get("maxItems");
  const maxItems =
    maxItemsRaw != null && String(maxItemsRaw).trim() !== "" && Number.isFinite(Number(maxItemsRaw))
      ? Number(maxItemsRaw)
      : undefined;
  const gameUrlsRaw = url.searchParams.get("gameUrls");
  const gameUrls =
    gameUrlsRaw != null && String(gameUrlsRaw).trim() !== ""
      ? String(gameUrlsRaw).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
  const slate = await loadFbisSlate(context.env, { sport, date });
  if (slate.gamesExpected === 0 && !slate.slateError) {
    return json(emptySlateResponse({
      sport,
      lifecycle,
      profile,
      slate,
      trigger: parseJobTrigger(context.request),
    }));
  }
  const plan = planCandidateCollection(context.env, {
    sport,
    lifecycle,
    profile,
    date,
    maxItems,
    gameUrls,
    slateExpected: slate.gamesExpected,
  });
  const mtd = await queryMonthToDateSpendUsd(db);
  const safety = evaluateSchedulerSafety(plan, { monthToDateCostUsd: mtd.mtdUsd });
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
      requestedMaxItems: plan.input.maxItems,
      expectedSlateGames: slate.gamesExpected,
      input: plan.input,
      cfg: {
        enabled: plan.cfg.enabled,
        plan: plan.cfg.plan,
        configured: plan.cfg.configured,
        maxItems: plan.cfg.maxItems,
        monthlyBudgetUsd: plan.cfg.monthlyBudgetUsd,
      },
    },
    budget: {
      monthToDateCostUsd: mtd.mtdUsd,
      estimatedNextRunUsd: plan.estimatedCostUsd,
      monthlyBudgetUsd: plan.cfg.monthlyBudgetUsd,
      remainingBudgetUsd: Math.max(0, Number(plan.cfg.monthlyBudgetUsd) - Number(mtd.mtdUsd || 0)),
    },
    safety,
    slateError: slate.slateError,
    slateDates: slate.slateDates || null,
    inProductionRouter: false,
    canQualify: false,
    canAuthorizeWager: false,
    note: "GET is plan/dry-run only. POST execute=1 to run candidate collection.",
  });
}

/**
 * POST — execute candidate collection when enabled.
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
  const maxItemsRaw = body.maxItems ?? url.searchParams.get("maxItems");
  const maxItems =
    maxItemsRaw != null && String(maxItemsRaw).trim() !== "" && Number.isFinite(Number(maxItemsRaw))
      ? Number(maxItemsRaw)
      : undefined;
  const gameUrlsRaw = body.gameUrls ?? body.gameIds ?? url.searchParams.get("gameUrls");
  const gameUrls = Array.isArray(gameUrlsRaw)
    ? gameUrlsRaw.map(String).filter(Boolean)
    : typeof gameUrlsRaw === "string" && gameUrlsRaw.trim()
      ? gameUrlsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
  const db = createCandidateDb(context.env);

  if (!execute) {
    const slateDry = await loadFbisSlate(context.env, { sport, date });
    const plan = planCandidateCollection(context.env, {
      sport,
      lifecycle,
      profile,
      date,
      maxItems,
      gameUrls,
      slateExpected: slateDry.gamesExpected,
    });
    const mtd = await queryMonthToDateSpendUsd(db);
    const safety = evaluateSchedulerSafety(plan, { monthToDateCostUsd: mtd.mtdUsd });
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
      budget: {
        monthToDateCostUsd: mtd.mtdUsd,
        estimatedNextRunUsd: plan.estimatedCostUsd,
        monthlyBudgetUsd: plan.cfg.monthlyBudgetUsd,
        remainingBudgetUsd: Math.max(0, Number(plan.cfg.monthlyBudgetUsd) - Number(mtd.mtdUsd || 0)),
      },
      safety,
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
    });
  }

  try {
    const slate = await loadFbisSlate(context.env, { sport, date });
    if (slate.gamesExpected === 0 && !slate.slateError) {
      return json(emptySlateResponse({
        sport,
        lifecycle,
        profile,
        slate,
        trigger: parseJobTrigger(context.request),
      }));
    }
    // Size to slate + soft board budget so harvest $1 soft-cap no longer blocks NFL/CFB.
    const sized = planCandidateCollection(context.env, {
      sport,
      lifecycle,
      profile,
      date,
      maxItems,
      gameUrls,
      slateExpected: slate.gamesExpected,
    });
    const result = await runCandidateCollection(context.env, {
      sport,
      lifecycle,
      profile,
      date,
      maxItems: sized.input.maxItems,
      gameUrls,
      fbisEvents: slate.fbisEvents,
      gamesExpected: slate.gamesExpected,
      db,
    });

    const safe = {
      ...result,
      rows: undefined,
      token: undefined,
      authorization: undefined,
    };
    const durableHealth = await loadDurableCandidateHealth(context.env, db, {
      sport,
      profile: profile || result.profile || "BASE",
      lifecycle,
    });
    return json(
      {
        ...safe,
        executed: true,
        expectedSlateGames: slate.gamesExpected,
        slateError: slate.slateError,
        slateDates: slate.slateDates || null,
        trigger: parseJobTrigger(context.request),
        inProductionRouter: false,
        canQualify: false,
        canAuthorizeWager: false,
        affectsProductionOdds: false,
        actionApify: durableHealth,
      },
      result.ok ? 200 : 502
    );
  } catch (err) {
    return json(
      {
        ok: false,
        executed: true,
        error: String(err?.message || err),
        inProductionRouter: false,
        canQualify: false,
        canAuthorizeWager: false,
        affectsProductionOdds: false,
      },
      502
    );
  }
}
