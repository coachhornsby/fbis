import { nflSportDbContext } from "../lib/nflSportDbContext.js";
import {loadCfbPublicWeek} from "../lib/cfbPublicSchedule.js";
import { isFbsVsFbsGame } from "../lib/cfbGameVisibility.js";
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
    SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
    BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
    CFBD_API_KEY: context.env.CFBD_API_KEY,
    caches: caches.default,
    ...nflSportDbContext(context.env), DB: context.env.DB,
  };
  let publicWeek = null;
  let publicScheduleError = null;
  if (sport === "cfb") {
    try { publicWeek = await loadCfbPublicWeek(resolved.date, env, weekShift); }
    catch(error) { publicScheduleError = String(error?.message || error); }
  }
  try {
    let payload = await buildSlate(sport, resolved.date, {...env,
      ...(publicWeek ? {prefetchedGames:publicWeek.games,cfbdScheduleFallback:false} : {})});
    if(publicWeek) payload.week = {mode:"cfb-week",shift:weekShift,number:publicWeek.week,range:publicWeek.range,source:publicWeek.source};
    if (sport === "cfb" && env.CFBD_API_KEY && !publicWeek) {
      const weekly = await fetchCfbdGamesForWeek(resolved.date, env.CFBD_API_KEY, weekShift).catch(error=>({games:[],error:String(error?.message||error)}));
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
    if (!rawDate && sport === "cfb" && payload.games?.length === 0 && env.CFBD_API_KEY && !publicWeek) {
      const nextDate = await findNextCfbdGameDate(resolved.date, env.CFBD_API_KEY, 14).catch(()=>null);
      if (nextDate && nextDate !== resolved.date) {
        payload = await buildSlate(sport, nextDate, env);
        payload.requestedDate = resolved.date;
      }
    }
    if(sport === "cfb") payload.cfbScheduleHealth={source:publicWeek?.source||"EXISTING_SCHEDULE",publicScheduleError,cfbdScheduleRequired:!publicWeek,
      observedAt:publicWeek?.observedAt||null,coverage:publicWeek?.coverage||null,
      state:publicWeek?(publicWeek.coverage?.successfulDays===7?'SOURCE_COMPLETE':'PARTIAL_SOURCE'):'FALLBACK_SOURCE'};
    return json(compactMlbSlatePayload(payload), 200, 30);
  } catch (err) {
    if(publicWeek?.games.length) {
      const games=publicWeek.games.map(g=>({...g,projectionUnavailable:true,marketUnavailable:true,
        qualificationBlocked:true,canQualify:false,canAuthorizeWager:false,blockReason:"CFB model unavailable; verified public schedule retained"}));
      return json({sport:"cfb",date:resolved.date,games,ticker:[],counts:{games:games.length},
        week:{mode:"cfb-week",shift:weekShift,number:publicWeek.week,range:publicWeek.range},
        cfbScheduleHealth:{source:publicWeek.source,observedAt:publicWeek.observedAt,coverage:publicWeek.coverage,
          state:publicWeek.coverage?.successfulDays===7?'SOURCE_COMPLETE':'PARTIAL_SOURCE',cfbdScheduleRequired:false},
        cfb:{state:"DEGRADED",source:publicWeek.source,reason:String(err?.message||err)},modelVersion:null},200,30);
    }
    if (sport === "cfb" && env.CFBD_API_KEY) {
      try {
        const weekly = await fetchCfbdGamesForWeek(resolved.date, env.CFBD_API_KEY, weekShift);
        const games = (weekly.games || []).filter(isFbsVsFbsGame).map((g) => ({
          ...g,
          projectionUnavailable: true,
          marketUnavailable: true,
          qualificationBlocked: true,
          blockReason: "CFB model unavailable: Worker subrequest limit",
        }));
        return json(
          {
            sport: "cfb",
            sportName: "College Football",
            date: resolved.date,
            generatedAt: new Date().toISOString(),
            counts: { games: games.length, live: 0, final: 0, upcoming: games.length },
            modelVersion: null,
            games,
            ticker: [],
            week: { mode: "cfb-week", shift: weekShift, number: weekly.week, range: weekly.range },
            cfb: { source: "cfbd", state: "DEGRADED", reason: "model-subrequest-limit", lastAttemptAt: new Date().toISOString() },
          },
          200,
          30
        );
      } catch {
        // fall through to canonical error
      }
    }
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
