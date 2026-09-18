import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { queryGames } from "../lib/store.js";
import { loadFbisSlateForMatching } from "../lib/actionApifyEvidence.js";
import {
  buildCostLedgerEntry,
  matchEventWithConfidence,
} from "../lib/actionApifyCandidate.js";
import {
  createResearchBudget,
  fitMaxItemsToUsdBudget,
  runActionApifyShadow,
} from "../lib/actionApifyShadow.js";
import { readCandidateConfig } from "../lib/actionApifyCandidateConfig.js";
import {
  ensureShadowProviderRun,
  persistFullMarketObservation,
} from "../lib/actionApifyObservationStore.js";
import { persistCandidateRunArtifacts } from "../lib/actionApifyCollector.js";

const TIME_ZONE = "America/Chicago";
const SPORTS = Object.freeze(["mlb", "nfl", "nba", "nhl", "cfb", "cbb"]);
const LEAGUE_BY_SPORT = Object.freeze({
  mlb: "mlb",
  nfl: "nfl",
  nba: "nba",
  nhl: "nhl",
  cfb: "ncaaf",
  cbb: "ncaab",
});
const PRO_SPORTS = new Set(["mlb", "nfl", "nba", "nhl"]);
const PROFILE = "DAILY";
const LIFECYCLE = "daily";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function createDb(env) {
  if (!env?.DB) return null;
  return {
    exec: async (sql, params = []) => env.DB.prepare(sql).bind(...params).run(),
    queryOne: async (sql, params = []) => (await env.DB.prepare(sql).bind(...params).first()) || null,
    queryAll: async (sql, params = []) => {
      const res = await env.DB.prepare(sql).bind(...params).all();
      return res?.results || [];
    },
  };
}

function zonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return { year: get("year"), month: get("month"), day: get("day"), hour: Number(get("hour")) };
}

function localDateKey(date = new Date()) {
  const p = zonedParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function previousDateKey(dateKey) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function monthlyBudgetUsd(env, now = new Date()) {
  const configured = Number(env?.ACTION_APIFY_HARD_MONTHLY_BUDGET_USD);
  const normal = Number.isFinite(configured) && configured > 0 ? configured : 15;
  // Temporary September 2026 recovery allowance. Automatically returns to the
  // normal configured/default ceiling on 2026-10-01.
  const recovery = now.getUTCFullYear() === 2026 && now.getUTCMonth() === 8 ? 25 : 0;
  return Math.max(normal, recovery);
}

function eventLocalDate(startTime) {
  const ms = Date.parse(String(startTime || ""));
  if (!Number.isFinite(ms)) return null;
  return localDateKey(new Date(ms));
}

function sportFromLeague(league) {
  const key = String(league || "").toLowerCase();
  if (key === "ncaaf" || key === "cfb") return "cfb";
  if (key === "ncaab" || key === "cbb") return "cbb";
  if (key === "baseball_mlb") return "mlb";
  if (key === "americanfootball_nfl") return "nfl";
  if (SPORTS.includes(key)) return key;
  return null;
}

async function loadDailySlate(env, today, yesterday) {
  const allEvents = [];
  const bySport = {};
  for (const sport of SPORTS) {
    let current = { gamesExpected: 0, fbisEvents: [], slateError: null };
    let prior = { gamesExpected: 0, fbisEvents: [], slateError: null };
    try {
      current = await loadFbisSlateForMatching(queryGames, env, { sport, date: today });
    } catch (err) {
      current = { gamesExpected: 0, fbisEvents: [], slateError: String(err?.message || err) };
    }
    try {
      prior = await loadFbisSlateForMatching(queryGames, env, { sport, date: yesterday });
    } catch (err) {
      prior = { gamesExpected: 0, fbisEvents: [], slateError: String(err?.message || err) };
    }
    const todayEvents = Array.isArray(current.fbisEvents) ? current.fbisEvents : [];
    const yesterdayEvents = Array.isArray(prior.fbisEvents) ? prior.fbisEvents : [];
    bySport[sport] = {
      today: todayEvents.length,
      yesterday: yesterdayEvents.length,
      errors: [current.slateError, prior.slateError].filter(Boolean),
    };
    allEvents.push(...todayEvents, ...yesterdayEvents);
  }
  return { allEvents, bySport };
}

async function monthSpend(db, now = new Date()) {
  if (!db) return 0;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const row = await db.queryOne(
    `SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END), 0) AS usd
     FROM shadow_cost_ledger WHERE created_at >= ?`,
    [monthStart],
  );
  return Number(row?.usd || 0);
}

async function alreadyRanToday(db, today) {
  if (!db) return false;
  const row = await db.queryOne(
    `SELECT id FROM shadow_collection_runs
     WHERE sport = 'all' AND profile = ? AND lifecycle = ?
       AND status LIKE 'success%'
       AND substr(started_at, 1, 10) >= ?
     ORDER BY started_at DESC LIMIT 1`,
    [PROFILE, LIFECYCLE, today],
  );
  return Boolean(row?.id);
}

function runArtifact({ runId, cfg, actor, startedAt, finishedAt, matched, unmatched, written, cost }) {
  return {
    run: {
      id: runId,
      plan: cfg.plan,
      profile: PROFILE,
      sport: "all",
      lifecycle: LIFECYCLE,
      status: actor.ok ? "success_daily" : "failed_daily",
      overlapBlocked: false,
      budgetBlocked: false,
      circuitOpen: false,
      apifyRunId: actor.runId || null,
      datasetId: actor.datasetId || null,
      requestedMaxItems: actor.input?.maxItems ?? null,
      gamesExpected: null,
      gamesReturned: actor.gamesReturned || 0,
      gamesMatched: matched,
      gamesUnmatched: unmatched,
      observationsWritten: written,
      duplicatesSkipped: 0,
      malformedRows: actor.malformed || 0,
      schemaFingerprint: null,
      schemaDriftLevel: null,
      estimatedCostUsd: actor.estimatedCostUsd ?? cost?.estimated_total_usd ?? null,
      actualCostUsd: null,
      costBasis: "ESTIMATED",
      errorClass: actor.ok ? null : "daily_actor_failure",
      errorMessage: actor.ok ? null : actor.error || "ACTION daily run failed",
      startedAt,
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      createdAt: startedAt,
    },
    cost,
  };
}

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);
  const now = new Date();
  const today = localDateKey(now);
  const yesterday = previousDateKey(today);
  const cfg = readCandidateConfig(context.env);
  const db = createDb(context.env);
  const slate = await loadDailySlate(context.env, today, yesterday);
  const activeSports = SPORTS.filter((s) => (slate.bySport[s]?.today || 0) + (slate.bySport[s]?.yesterday || 0) > 0);
  return json({
    ok: true,
    executed: false,
    mode: "daily_action_snapshot",
    schedule: "07:00 America/Chicago",
    today,
    yesterday,
    activeSports,
    slate: slate.bySport,
    monthToDateUsd: await monthSpend(db, now),
    monthlyBudgetUsd: monthlyBudgetUsd(context.env, now),
    configured: cfg.configured,
    enabled: cfg.enabled,
    onePaidRunPerLocalDay: true,
    includes: {
      todayCurrentLines: true,
      todayPublicSplits: true,
      todayPlayerPropsProOnlyOnPersist: true,
      yesterdayClosingBackfillWhenReturnedByAction: true,
      lineMovementHistory: true,
    },
    note: "GET is planning only; no Apify spend.",
  });
}

export async function onRequestPost(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);

  const now = new Date();
  const parts = zonedParts(now);
  const today = localDateKey(now);
  const yesterday = previousDateKey(today);
  const url = new URL(context.request.url);
  let body = {};
  try { body = await context.request.json(); } catch { body = {}; }
  const execute = String(url.searchParams.get("execute") || body.execute || "") === "1";
  const manual = String(url.searchParams.get("manual") || body.manual || "") === "1";
  if (!execute) return json({ ok: true, executed: false, reason: "execute=1 required" });
  if (!manual && parts.hour !== 7) {
    return json({
      ok: true,
      executed: false,
      status: "outside_daily_window",
      reason: `daily ACTION run is restricted to 07:00 ${TIME_ZONE}`,
      localHour: parts.hour,
      today,
    });
  }

  const db = createDb(context.env);
  if (!db) return json({ ok: false, executed: false, status: "d1_unavailable" }, 503);
  if (await alreadyRanToday(db, today)) {
    return json({ ok: true, executed: false, status: "already_collected_today", today });
  }

  const cfg = readCandidateConfig(context.env);
  if (!cfg.enabled || !cfg.configured) {
    return json({ ok: true, executed: false, status: "action_not_configured", enabled: cfg.enabled, configured: cfg.configured });
  }

  const slate = await loadDailySlate(context.env, today, yesterday);
  const activeSports = SPORTS.filter((s) => (slate.bySport[s]?.today || 0) + (slate.bySport[s]?.yesterday || 0) > 0);
  const leagues = activeSports.map((s) => LEAGUE_BY_SPORT[s]).filter(Boolean);
  if (!leagues.length) {
    return json({ ok: true, executed: false, status: "no_slate", today, yesterday, slate: slate.bySport });
  }

  const requestedRows = Math.max(1, Math.min(200, slate.allEvents.length + 12));
  const perRunBudgetUsd = Number(context.env.ACTION_APIFY_DAILY_RUN_BUDGET_USD || 1.0);
  const monthlyBudgetUsd = monthlyBudgetUsd(context.env, now);
  const inputBase = {
    leagues,
    periods: ["event"],
    maxItems: requestedRows,
    freePlan: cfg.plan === "free",
    includeLineMovement: true,
    includePlayerProps: true,
    includeGameProps: false,
    includeGameDetail: false,
    includeWeather: false,
    includeInjuries: false,
    includeStandings: false,
    includeFutures: false,
    gameStatus: "any",
    onlyWithOdds: true,
  };
  const fitted = cfg.plan === "starter"
    ? fitMaxItemsToUsdBudget(inputBase, perRunBudgetUsd)
    : { maxItems: Math.min(10, requestedRows), estimatedCostUsd: null };
  const input = { ...inputBase, maxItems: fitted.maxItems };
  const mtd = await monthSpend(db, now);
  const estimate = Number(fitted.estimatedCostUsd || 0);
  if (estimate > 0 && mtd + estimate > monthlyBudgetUsd + 1e-9) {
    return json({
      ok: true,
      executed: false,
      status: "monthly_budget_blocked",
      monthToDateUsd: mtd,
      estimatedNextRunUsd: estimate,
      monthlyBudgetUsd,
    });
  }

  const startedAt = new Date().toISOString();
  const budget = createResearchBudget({ limitUsd: perRunBudgetUsd });
  const actor = await runActionApifyShadow(context.env, { ...input, budget, waitSecs: 420, testId: `daily_${today}` });
  const runId = `daily_${today.replaceAll("-", "")}_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let matched = 0;
  let unmatched = 0;
  let written = 0;
  let todayRows = 0;
  let closeRows = 0;
  let propsRows = 0;

  if (actor.ok) {
    await ensureShadowProviderRun(db, {
      runId,
      plan: {
        apifyRunId: actor.runId,
        datasetId: actor.datasetId,
        input: actor.input,
        profile: PROFILE,
        gamesReturned: actor.gamesReturned,
        malformedRows: actor.malformed,
        estimatedCostUsd: actor.estimatedCostUsd,
      },
      startedAt,
      finishedAt: new Date().toISOString(),
      status: actor.status || "SUCCEEDED",
    });

    for (const row of actor.rows || []) {
      const rowDate = eventLocalDate(row.startTime);
      if (rowDate !== today && rowDate !== yesterday) continue;
      const sport = sportFromLeague(row.league);
      if (!sport) continue;
      const match = matchEventWithConfidence(row, slate.allEvents);
      if (match.comparisonEligible) matched += 1;
      else unmatched += 1;
      const isClose = rowDate === yesterday && Boolean(row.result?.isFinal || /final|complete/i.test(String(row.status || "")));
      const isToday = rowDate === today;
      const persistProps = isToday && PRO_SPORTS.has(sport);
      if (isToday) todayRows += 1;
      if (isClose) closeRows += 1;
      const result = await persistFullMarketObservation(db, row, {
        runId,
        sport,
        profile: PROFILE,
        lifecycle: isClose ? "postgame" : "daily_open",
        temporalClass: isClose ? "evaluation_close" : "pregame_observation",
        snapshotType: isClose ? "CLOSE" : "OPEN",
        match,
        collectedAt: new Date().toISOString(),
        persistMovement: true,
        persistProps,
      });
      written += 1;
      propsRows += Number(result?.props || 0);
    }
  }

  const finishedAt = new Date().toISOString();
  const cost = actor.ok
    ? buildCostLedgerEntry({
        runId,
        plan: cfg.plan,
        sport: "all",
        profile: PROFILE,
        input: actor.input || input,
        gamesReturned: actor.gamesReturned || 0,
        createdAt: startedAt,
      })
    : null;
  await persistCandidateRunArtifacts(db, runArtifact({ runId, cfg, actor, startedAt, finishedAt, matched, unmatched, written, cost }));

  return json({
    ok: Boolean(actor.ok),
    executed: true,
    status: actor.ok ? "success_daily" : "failed_daily",
    today,
    yesterday,
    activeSports,
    leagues,
    requestedRows,
    maxItems: input.maxItems,
    gamesReturned: actor.gamesReturned || 0,
    matched,
    unmatched,
    observationsWritten: written,
    todayRows,
    closeRows,
    propsWritten: propsRows,
    estimatedCostUsd: actor.estimatedCostUsd ?? estimate,
    monthToDateBeforeUsd: mtd,
    monthlyBudgetUsd,
    note: closeRows > 0
      ? "Yesterday completed rows were persisted as evaluation CLOSE snapshots."
      : "No yesterday completed rows were returned by ACTION in this single paid run; no second paid request was made.",
    inProductionRouter: false,
    canQualify: false,
    canAuthorizeWager: false,
    affectsProductionOdds: false,
    error: actor.ok ? null : actor.error || null,
  }, actor.ok ? 200 : 502);
}
