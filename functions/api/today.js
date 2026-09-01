import { buildTodayBoard, resolveTodayDate } from "../lib/todayBoard.js";
import { durableHealth, scheduledHealth } from "../lib/jobs.js";
import { pingDb, countToday, readMeta, queryExecutedBets } from "../lib/store.js";
import { todayCT } from "../lib/slateEngine.js";
import { attachMyBetsToBoard } from "../lib/executedBets.js";
import { deriveHealthState } from "../lib/healthContract.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const resolved = resolveTodayDate(url.searchParams.get("date") || "");
  const focusSport = (url.searchParams.get("sport") || "all").toLowerCase();
  const attemptAt = new Date().toISOString();
  if (!resolved.ok) {
    return json({ error: resolved.error, date: resolved.date, games: [], sports: [], counts: {} }, 400);
  }
  const env = {
    PARLAY_API_KEY: context.env.PARLAY_API_KEY,
    THEODDS_API_KEY: context.env.THEODDS_API_KEY,
    BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
    CFBD_API_KEY: context.env.CFBD_API_KEY,
    caches: caches.default,
    DB: context.env.DB,
  };
  try {
    const board = await buildTodayBoard(resolved.date, env, { focusSport });
    const betsQ = await queryExecutedBets(env, { date: resolved.date, includeRaw: false });
    const withBets = attachMyBetsToBoard(board, betsQ.rows || []);
    const ping = await pingDb(env);
    const counts = await countToday(env, resolved.date);
    const durable = await durableHealth(env);
    const meta = await readMeta(env);
    const sourceStatus = buildTodaySourceStatus(board);
    const schedule = scheduledHealth(durable, new Date());
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
          freshnessMs: 8 * 60 * 60 * 1000,
        },
        {
          name: "scheduled-harvest",
          ok: schedule?.harvest?.state === "healthy",
          source: "d1",
          detail: schedule?.harvest?.state || "unknown",
          lastSuccessAt: durable.lastScheduledHarvestSuccessAt || null,
          freshnessMs: 8 * 60 * 60 * 1000,
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
      projectionsAvailable: board.games.filter((g) => !g.projectionUnavailable).length,
      marketsAvailable: board.games.filter((g) => !g.marketUnavailable).length,
      qualifiedTickets: board.counts.qualified,
      openFailures: Object.entries(board.feeds)
        .filter(([, f]) => f?.error)
        .map(([sport, f]) => `${sport}: ${f.error}`),
      sourceStatus,
      checks: semantic.checks,
      failures: semantic.failures,
      pal: {
        lastSuccess: meta.last_pal_success_at || board.feeds.mlb?.pal?.asOf || null,
        error: meta.last_pal_error || board.feeds.mlb?.pal?.error || null,
        matched: meta.last_pal_matched != null && meta.last_pal_matched !== "" ? Number(meta.last_pal_matched) : board.games.filter((g) => g.sport === "mlb" && g.palMatched).length,
        unmatched: meta.last_pal_unmatched != null && meta.last_pal_unmatched !== "" ? Number(meta.last_pal_unmatched) : board.games.filter((g) => g.sport === "mlb" && !g.palMatched).length,
        ambiguous: Number(meta.last_pal_ambiguous || 0),
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
      },
      todayCacheOnly: board?.parlay?.cacheOnly !== false,
      todayFocusSport: board?.parlay?.focusSport || "all",
      todayCt: todayCT(),
    };
    return json({ ...withBets, health, db: { ...ping, ...counts } }, 200, 30);
  } catch (err) {
    return json(
      { error: String(err?.message || err), date: resolved.date, games: [], sports: [], counts: {}, feeds: {} },
      502
    );
  }
}

function BOARD_SPORTS_OK(board) {
  return (board.sports || []).filter((s) => !s.error).map((s) => s.sport);
}

function buildTodaySourceStatus(board) {
  const feeds = board?.feeds || {};
  const statuses = {};
  const requiredChecks = [];
  for (const [sport, feed] of Object.entries(feeds)) {
    const scheduleOk = feed?.ok !== false;
    const projectionOk = Number(feed?.n || 0) > 0 || scheduleOk;
    const marketOk = !feed?.error;
    const source = feed?.cachedParlay ? "cache" : "live";
    statuses[sport] = {
      schedule: scheduleOk ? "ok" : "failed",
      projections: projectionOk ? "ok" : "failed",
      markets: marketOk ? "ok" : "failed",
      source,
      error: feed?.error || null,
    };
    requiredChecks.push({
      name: `${sport}-schedule`,
      ok: scheduleOk,
      source,
      detail: feed?.error || "ok",
    });
    requiredChecks.push({
      name: `${sport}-projection`,
      ok: projectionOk,
      source,
      detail: Number(feed?.n || 0) > 0 ? `n=${feed.n}` : "no-games",
    });
    requiredChecks.push({
      name: `${sport}-market`,
      ok: marketOk,
      source,
      detail: feed?.error || "ok",
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
