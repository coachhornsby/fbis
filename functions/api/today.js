import { buildTodayBoard, resolveTodayDate } from "../lib/todayBoard.js";
import { durableHealth } from "../lib/jobs.js";
import { pingDb, countToday, readMeta, queryExecutedBets } from "../lib/store.js";
import { todayCT } from "../lib/slateEngine.js";
import { attachMyBetsToBoard } from "../lib/executedBets.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const resolved = resolveTodayDate(url.searchParams.get("date") || "");
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
    const board = await buildTodayBoard(resolved.date, env);
    const betsQ = await queryExecutedBets(env, { date: resolved.date, includeRaw: false });
    const withBets = attachMyBetsToBoard(board, betsQ.rows || []);
    const ping = await pingDb(env);
    const counts = await countToday(env, resolved.date);
    const durable = await durableHealth(env);
    const meta = await readMeta(env);
    const health = {
      lastCollect: durable.lastCollectSuccessAt || meta.last_collect_at || null,
      lastHarvest: durable.lastHarvestSuccessAt || meta.last_harvest_at || null,
      d1: ping.ok ? "connected" : ping.reason || "error",
      sportsLoaded: BOARD_SPORTS_OK(board),
      gamesLoaded: board.counts.games,
      projectionsAvailable: board.games.filter((g) => !g.projectionUnavailable).length,
      marketsAvailable: board.games.filter((g) => !g.marketUnavailable).length,
      qualifiedTickets: board.counts.qualified,
      openFailures: Object.entries(board.feeds)
        .filter(([, f]) => f?.error)
        .map(([sport, f]) => `${sport}: ${f.error}`),
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
