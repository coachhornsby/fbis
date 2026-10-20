import { buildTodayBoard, resolveTodayDate } from "../lib/todayBoard.js";
import { durableHealth, scheduledHealth } from "../lib/jobs.js";
import { pingDb, countToday, readMeta, queryExecutedBets } from "../lib/store.js";
import { todayCT } from "../lib/slateEngine.js";
import { attachMyBetsToBoard } from "../lib/executedBets.js";
import { deriveHealthState, writeVerificationState } from "../lib/healthContract.js";
import { populationDescriptor, POPULATION_TYPE } from "../lib/populationDescriptor.js";
import { toDomainTodayBoard } from "../lib/fbisDomain.js";

export function todayEnv(context) {
  return {
    PARLAY_API_KEY: context.env.PARLAY_API_KEY,
    THEODDS_API_KEY: context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
    BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
    CFBD_API_KEY: context.env.CFBD_API_KEY,
    CBBD_API_KEY: context.env.CBBD_API_KEY,
    KENPOM_API_KEY: context.env.KENPOM_API_KEY,
    caches: caches.default,
    DB: context.env.DB,
    TIER3_DB: context.env.TIER3_DB,
    MARKET_HISTORY_DB: context.env.MARKET_HISTORY_DB,
    // Required for Q4 Polymarket/PinnOdds board overlays (listMarketHistoryReadDbs).
    MARKET_HISTORY_2026Q4_DB: context.env.MARKET_HISTORY_2026Q4_DB,
    ARCHIVE: context.env.ARCHIVE,
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const resolved = resolveTodayDate(url.searchParams.get("date") || "");
  const focusSport = (url.searchParams.get("sport") || "all").toLowerCase();
  const attemptAt = new Date().toISOString();
  if (!resolved.ok) {
    return json({ error: resolved.error, date: resolved.date, games: [], sports: [], counts: {} }, 400);
  }
  const env = todayEnv(context);
  try {
    const [board,ping] = await Promise.all([buildTodayBoard(resolved.date, env, { focusSport }),pingDb(env)]);
    const [betsQ,counts,durable,meta]=await Promise.all([
      ping.ok ? queryExecutedBets(env, { date: resolved.date, includeRaw: false }) : { ok: false, rows: [] },
      ping.ok ? countToday(env, resolved.date) : { predictions: null, graded: null, awaiting: null, failedWrites: null, failedHarvests: null },
      durableHealth(env),ping.ok ? readMeta(env) : {},
    ]);
    const withBets = attachMyBetsToBoard(board, betsQ.rows || []);
    const sourceStatus = buildTodaySourceStatus(board);
    const schedule = scheduledHealth(durable, new Date());
    const writeVerification = writeVerificationState({
      readOk: ping.ok,
      lastWriteSuccessAt: durable.lastD1WriteSuccessAt || null,
      lastReadbackSuccessAt: durable.lastD1ReadbackSuccessAt || durable.lastD1WriteSuccessAt || null,
      lastFailureAt: durable.lastD1FailureAt || durable.lastFailedCollectAt || durable.lastFailedHarvestAt || null,
      failedWrites: Number(durable.failedWrites || 0) + Number(durable.failedHarvests || 0),
      reason: ping.reason || durable.lastError || "",
    });
    const hasAuthoritativeData = ping.ok && (board?.counts?.games > 0 || board?.empty?.kind === "no-games");
    const semantic = deriveHealthState({
      hasAuthoritativeData,
      requiredChecks: [
        { name: "d1-binding", ok: Boolean(env.DB), source: "d1" },
        { name: "d1-read", ok: ping.ok, source: ping.ok ? "d1" : "d1-error", detail: ping.reason || null },
        {
          name: "scheduled-collect",
          ok: schedule?.collect?.state === "healthy",
          source: "d1",
          detail: schedule?.collect?.state || "unknown",
          lastSuccessAt: durable.lastScheduledCollectSuccessAt || null,
          // Match production cadence: longest collect gap is ~11h.
          freshnessMs: 12 * 60 * 60 * 1000,
        },
        {
          name: "scheduled-harvest",
          ok: schedule?.harvest?.state === "healthy",
          source: "d1",
          detail: schedule?.harvest?.state || "unknown",
          lastSuccessAt: durable.lastScheduledHarvestSuccessAt || null,
          // Harvest runs at 11:20/16:20 UTC; overnight gap is ~19h.
          freshnessMs: 20 * 60 * 60 * 1000,
        },
        ...sourceStatus.requiredChecks,
      ],
    });
    const health = {
      state: semantic.state,
      currentAttemptAt: attemptAt,
      lastCollect: durable.lastCollectSuccessAt || meta.last_collect_at || null,
      lastHarvest: durable.lastHarvestSuccessAt || meta.last_harvest_at || null,
      d1: ping.ok ? "healthy" : ping.reason || "error",
      sportsLoaded: BOARD_SPORTS_OK(board),
      gamesLoaded: board.counts.games,
      durableFallbackGames: Number(board?.counts?.durableFallbackGames || 0),
      boardDeliveryMode: board?.parlay?.durableReadOnly ? "D1_UNVERIFIED_MATCHUPS" : "RESEARCH_FEEDS",
      projectionsAvailable: board.games.filter((g) => !g.projectionUnavailable).length,
      // Execution/consensus operational markets only (legacy field name preserved).
      marketsAvailable: board.games.filter((g) => !g.marketUnavailable).length,
      researchMarketsAvailable: board.games.filter((g) => gameHasResearchMarketDelivery(g)).length,
      pinnoddsCaptures: board.games.filter((g) => Array.isArray(g?.pinnoddsResearch?.offers) && g.pinnoddsResearch.offers.length > 0).length,
      exchangeOffers: board.games.filter((g) => Array.isArray(g?.market?.venueOffers) && g.market.venueOffers.length > 0).length,
      qualifiedTickets: board.counts.qualified,
      openFailures: Object.entries(board.feeds)
        .filter(([, f]) => f?.error)
        .map(([sport, f]) => `${sport}: ${f.error}`),
      sourceStatus,
      checks: semantic.checks,
      failures: semantic.failures,
      writeVerification,
      pal: {
        lastSuccess: meta.last_pal_success_at || board.feeds.mlb?.pal?.asOf || null,
        error: meta.last_pal_error || board.feeds.mlb?.pal?.error || null,
        matched: board.games.filter((g) => g.sport === "mlb" && g.palMatched).length,
        unmatched: board.games.filter((g) => g.sport === "mlb" && !g.palMatched).length,
        ambiguous: 0,
        recordsReturned: Number(meta.last_pal_records_returned || 0),
        usable: Number(meta.last_pal_usable || 0),
        persisted: Number(meta.last_pal_persisted || 0),
        mlbGames: Number(meta.last_pal_mlb_games || 0),
        requestId: meta.last_pal_request_id || null,
        asOf: meta.last_pal_as_of || null,
        httpStatus: meta.last_pal_http_status || null,
        reason: meta.last_pal_reason || board.feeds.mlb?.palReason || null,
        lastAttemptAt: meta.last_pal_attempt_at || null,
        lastAttemptHttpStatus: meta.last_pal_attempt_http_status || null,
        lastAttemptError: meta.last_pal_attempt_error || null,
        availableFromCache: Boolean(meta.last_pal_success_at && meta.last_pal_attempt_http_status === "429"),
        upstreamLastRun: {
          matched: meta.last_pal_matched != null && meta.last_pal_matched !== "" ? Number(meta.last_pal_matched) : null,
          unmatched: meta.last_pal_unmatched != null && meta.last_pal_unmatched !== "" ? Number(meta.last_pal_unmatched) : null,
          ambiguous: Number(meta.last_pal_ambiguous || 0),
        },
      },
      todayCacheOnly: board?.parlay?.cacheOnly !== false,
      todayFocusSport: board?.parlay?.focusSport || "all",
      todayCt: todayCT(),
    };
    const successfulSports = Object.entries(sourceStatus.statuses)
      .filter(([, s]) =>
        ["ok", "no-games"].includes(s.schedule) &&
        ["ok", "no-games"].includes(s.projections) &&
        // research-only means delivery succeeded; qualification is separate.
        ["ok", "research-only", "no-games"].includes(s.markets)
      )
      .map(([k]) => k);
    const failedSports = Object.entries(sourceStatus.statuses)
      .filter(([k]) => !successfulSports.includes(k))
      .map(([k]) => k);
    const allSportsAuthoritative = failedSports.length === 0 && Number(board?.counts?.durableFallbackGames || 0) === 0;
    const domain = toDomainTodayBoard(withBets, {
      date: resolved.date,
      sportFilter: focusSport || "all",
      generatedAt: attemptAt,
    });
    return json({
      ...withBets,
      // Additive FBIS domain contract for product UI (does not replace legacy board fields).
      domain,
      health,
      db: { ...ping, ...counts },
      telemetry: {
        endpoint: "/api/today",
        requestCount: 1,
        queryCountEstimate: ping.ok ? 5 : 1,
        rowsReadEstimate: ping.ok ? Number((withBets.games || []).length + (betsQ.rows || []).length) : 0,
        cacheStatus: board?.parlay?.cacheOnly ? "cache-only" : "mixed-live",
        dateRange: { since: resolved.date, until: resolved.date },
        lastQuotaFailure: ping.ok ? null : (ping.reason || null),
      },
      coverage: {
        successfulSports,
        failedSports,
        allSportsAuthoritative,
        qualificationAuthoritative: allSportsAuthoritative,
        denominator: Object.keys(sourceStatus.statuses).length,
        numerator: successfulSports.length,
      },
      population: {
        board: populationDescriptor({
          populationType: POPULATION_TYPE.FROZEN_PROJECTION,
          sport: focusSport || "all",
          marketFamily: "mixed",
          periodFamily: "mixed",
          modelVersion: withBets.modelVersion || null,
          checkpoint: "LATEST",
          dateRange: { since: resolved.date, until: resolved.date },
          settledN: Number(withBets.counts?.final || 0),
          openN: Number(withBets.counts?.scheduled || 0) + Number(withBets.counts?.live || 0),
          unresolvedN: Number(withBets.counts?.postponed || 0),
          sourceHealth: semantic.state,
          freshness: { attemptAt, lastSuccessAt: durable.lastCollectSuccessAt || null },
        }),
      },
    }, 200, 30);
  } catch (err) {
    // Keep the Board transport available even when an upstream/provider path
    // throws. The payload remains explicitly UNAVAILABLE and carries no games,
    // so qualification still fails closed without turning a recoverable data
    // outage into a Cloudflare 5xx page failure.
    const message = String(err?.message || err);
    return json({
      ok: false,
      error: message,
      date: resolved.date,
      timezone: "America/Chicago",
      games: [],
      sports: [],
      groups: [],
      counts: { games: 0, scheduled: 0, live: 0, final: 0, qualified: 0, leans: 0, postponed: 0 },
      feeds: {},
      health: {
        state: "UNAVAILABLE",
        currentAttemptAt: attemptAt,
        failures: [{ name: "today-board", source: "server", detail: message }],
      },
      empty: { kind: "feed-failure", message: "Today board data is temporarily unavailable." },
    }, 200, 0);
  }
}

function BOARD_SPORTS_OK(board) {
  return (board.sports || []).filter((s) => !s.error).map((s) => s.sport);
}

function upstreamSourceState(raw) {
  if (!raw) return { state: "not-reported", configured: null, records: null, asOf: null, error: null };
  const meta = raw?.meta && typeof raw.meta === "object" ? { ...raw, ...raw.meta } : raw;
  const configured = meta.configured ?? meta.enabled ?? null;
  const error = meta.error || (meta.reason === "upstream-error" || meta.reason === "no-api-key" ? meta.reason : null);
  const recordCandidates = [
    meta.records,
    meta.recordsReturned,
    meta.teams,
    meta.available,
    meta.matched,
    meta.n,
  ];
  const records = recordCandidates.map(Number).find(Number.isFinite);
  let state = "ok";
  if (configured === false) state = "not-configured";
  else if (error) state = "error";
  else if (records === 0) state = "empty";
  return {
    state,
    configured: configured == null ? null : Boolean(configured),
    records: records == null ? null : records,
    asOf: meta.asOf || meta.lastSuccess || meta.generatedAt || null,
    httpStatus: meta.httpStatus == null ? null : Number(meta.httpStatus),
    source: meta.source || null,
    error: error ? String(error) : null,
  };
}

/** Research delivery: PinnOdds reference captures and/or exchange overlays on the card. */
export function gameHasResearchMarketDelivery(game) {
  const pinOffers = Array.isArray(game?.pinnoddsResearch?.offers) ? game.pinnoddsResearch.offers.length : 0;
  const venueOffers = Array.isArray(game?.market?.venueOffers) ? game.market.venueOffers.length : 0;
  return pinOffers > 0 || venueOffers > 0;
}

export function buildTodaySourceStatus(board) {
  const feeds = board?.feeds || {};
  const statuses = {};
  const requiredChecks = [];
  for (const [sport, feed] of Object.entries(feeds)) {
    const games = (board?.games || []).filter((game) => game?.sport === sport);
    const usableMarkets = games.filter((game) => !game?.marketUnavailable).length;
    const researchMarkets = games.filter((game) => gameHasResearchMarketDelivery(game)).length;
    const pinnoddsCaptures = games.filter((game) => Array.isArray(game?.pinnoddsResearch?.offers) && game.pinnoddsResearch.offers.length > 0).length;
    const exchangeOffers = games.filter((game) => Array.isArray(game?.market?.venueOffers) && game.market.venueOffers.length > 0).length;
    const projectedGames = games.filter((game) => !game?.projectionUnavailable).length;
    const scheduleOk = feed?.ok !== false && !feed?.error;
    // Empty slate (no games) is healthy. A sport with games needs real projections —
    // schedule transport success alone is not projection coverage.
    const projectionOk = games.length === 0 ? scheduleOk : projectedGames > 0;
    // Delivery health ≠ execution/qualification. Research overlays (PinnOdds /
    // Polymarket/Kalshi) count as successful market delivery; zero EXEC MKT or
    // zero QUALIFIED tickets must not alone mark the sport market check failed.
    const marketDeliveryOk = !feed?.error && (games.length === 0 || usableMarkets > 0 || researchMarkets > 0);
    const marketsState = games.length === 0
      ? "no-games"
      : usableMarkets > 0
        ? "ok"
        : researchMarkets > 0
          ? "research-only"
          : "unavailable";
    const source = feed?.cachedParlay ? "cache" : "live";
    const upstream = Object.fromEntries(
      Object.entries(feed?.sources || {}).map(([name, meta]) => [name, upstreamSourceState(meta)])
    );
    statuses[sport] = {
      schedule: scheduleOk ? (games.length === 0 ? "no-games" : "ok") : "failed",
      projections: games.length === 0 ? "no-games" : projectionOk ? "ok" : "unavailable",
      markets: marketsState,
      games: games.length,
      projectedGames,
      usableMarkets,
      researchMarkets,
      pinnoddsCaptures,
      exchangeOffers,
      source,
      upstream,
      upstreamProblems: Object.entries(upstream)
        .filter(([, row]) => ["error", "not-configured"].includes(row.state))
        .map(([name, row]) => ({ source: name, ...row })),
      error: feed?.error || null,
    };
    requiredChecks.push({
      name: `${sport}-schedule`,
      ok: scheduleOk,
      source,
      detail: feed?.error || (games.length === 0 ? "no-games" : "ok"),
    });
    requiredChecks.push({
      name: `${sport}-projection`,
      ok: projectionOk,
      source,
      detail: games.length === 0 ? "no-games" : `projected=${projectedGames}/${games.length}`,
    });
    requiredChecks.push({
      name: `${sport}-market`,
      ok: marketDeliveryOk,
      source,
      detail: feed?.error || (games.length === 0
        ? "no-games"
        : `exec=${usableMarkets} research=${researchMarkets} pin=${pinnoddsCaptures} exchange=${exchangeOffers} /${games.length}`),
    });
  }
  return { statuses, requiredChecks };
}

function json(data, status = 200, maxAge = 30) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      "access-control-allow-origin": "*",
    },
  });
}
