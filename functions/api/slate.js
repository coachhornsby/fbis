import { buildSlate, resolveSlateDate, findNextCfbdGameDate, fetchCfbdGamesForWeek } from "../lib/slateEngine.js";
import { compactMlbSlatePayload } from "../lib/propConviction.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = url.searchParams.get("sport") || "mlb";
  const rawDate = url.searchParams.get("date") || "";
  const weekShift = Number(url.searchParams.get("weekShift") || 0);
  const resolved = resolveSlateDate(rawDate, slateDateWindowForSport(sport));
  if (rawDate && !resolved.ok) {
    return json({ error: resolved.error, games: [], ticker: [], counts: {} }, 400, 10);
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
    let payload = await buildSlate(sport, resolved.date, env);
    if (sport === "cfb" && env.CFBD_API_KEY) {
      const weekly = await fetchCfbdGamesForWeek(resolved.date, env.CFBD_API_KEY, weekShift);
      if ((weekly.games || []).length) {
        payload = await buildSlate(sport, resolved.date, {
          ...env,
          prefetchedGames: weekly.games,
        });
        payload.week = {
          mode: "cfb-week",
          shift: weekShift,
          number: weekly.week,
          range: weekly.range,
        };
      }
    }
    if (!rawDate && sport === "cfb" && payload.games?.length === 0 && env.CFBD_API_KEY) {
      const nextDate = await findNextCfbdGameDate(resolved.date, env.CFBD_API_KEY, 14);
      if (nextDate && nextDate !== resolved.date) {
        payload = await buildSlate(sport, nextDate, env);
        payload.requestedDate = resolved.date;
      }
    }
    return json(compactMlbSlatePayload(payload), 200, 30);
  } catch (err) {
    return json({ error: String(err?.message || err), games: [], ticker: [], counts: {} }, 502, 10);
  }
}

function slateDateWindowForSport(sport) {
  if (sport === "cfb" || sport === "cbb") {
    // College schedules are sparse; allow operators to view upcoming boards.
    return { maxPast: 7, maxFuture: 14 };
  }
  return { maxPast: 2, maxFuture: 1 };
}

function json(data, status, maxAge) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      "access-control-allow-origin": "*",
    },
  });
}
