import { buildSlate, resolveSlateDate, recommendBundle, SPORTS } from "../lib/slateEngine.js";
import { DEFAULT_WEIGHTS } from "../lib/weights.js";
import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { expectedRoi, validAmericanOdds } from "../lib/pricing.js";

const SUPPORTED = new Set(["mlb","npb","kbo","nfl","cfb","cbb","nba","wnba","nhl"]);

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function minAcceptableAmerican(p, minEv = 0.03) {
  const prob = finite(p);
  const floor = finite(minEv);
  if (prob == null || floor == null || prob <= 0 || prob >= 1) return null;
  const profitMultiple = (1 - prob + floor) / prob;
  if (!(profitMultiple > 0)) return null;
  return profitMultiple >= 1
    ? Math.ceil(profitMultiple * 100)
    : -Math.floor(100 / profitMultiple);
}

function checkpoint(start) {
  const ms = Date.parse(start || "");
  if (!Number.isFinite(ms)) return "CURRENT";
  const hours = (ms - Date.now()) / 3600000;
  if (hours <= 0) return "LIVE_OR_FINAL";
  if (hours <= 1.5) return "CLOSE";
  if (hours <= 4) return "PREGAME";
  if (hours <= 10) return "MIDDAY";
  return "MORNING";
}

function matchup(game = {}) {
  const away = game?.away?.abbr || game?.away?.name || "AWAY";
  const home = game?.home?.abbr || game?.home?.name || "HOME";
  return `${away} @ ${home}`;
}

function gameDate(start) {
  if (!start) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(start));
  } catch {
    return String(start).slice(0,10);
  }
}

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) {
    return json(unauthorizedBody(auth.reason), 401);
  }

  const url = new URL(context.request.url);
  const sport = String(url.searchParams.get("sport") || "").toLowerCase();
  if (!SUPPORTED.has(sport)) return json({ ok:false, error:"unsupported-sport", rows:[] }, 400);

  const rawDate = url.searchParams.get("date") || "";
  const window = sport === "cfb" || sport === "cbb"
    ? { maxPast: 7, maxFuture: 14 }
    : { maxPast: 2, maxFuture: 3 };
  const resolved = resolveSlateDate(rawDate, window);
  if (rawDate && !resolved.ok) return json({ ok:false, error:resolved.error, rows:[] }, 400);

  const env = {
    PARLAY_API_KEY: context.env.PARLAY_API_KEY,
    THEODDS_API_KEY: context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
    BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
    CFBD_API_KEY: context.env.CFBD_API_KEY,
    CBBD_API_KEY: context.env.CBBD_API_KEY,
    DB: context.env.DB,
    caches: caches.default,
    parlayCacheOnly: true,
    palCacheOnly: true,
    cfbdScheduleFallback: false,
  };

  try {
    const slate = await buildSlate(sport, resolved.date, env);
    const generatedAt = new Date().toISOString();
    const cfg = SPORTS[sport] || {};
    const minEv = finite(cfg.minEv) ?? 0.03;
    const rows = [];

    for (const game of slate.games || []) {
      if (game?.status?.live || game?.status?.completed) continue;
      const bundle = recommendBundle(sport, game, game.model, DEFAULT_WEIGHTS);
      const rec = bundle?.qualified || null;
      if (!rec) continue;

      const modelProbability = finite(rec.modelProbability ?? rec.fair);
      const qualificationPrice = finite(rec.qualificationPrice ?? rec.pinPrice);
      const executionPrice = finite(rec.executionPrice);
      const qualificationEv = finite(rec.expectedRoi ?? rec.ev);
      const executionEv = modelProbability != null && validAmericanOdds(executionPrice)
        ? expectedRoi(modelProbability, executionPrice)
        : null;
      const ready = executionEv != null && executionEv >= minEv;
      const minOdds = minAcceptableAmerican(modelProbability, minEv);

      rows.push({
        generatedAt,
        gameDate: gameDate(game.start),
        eventStart: game.start || null,
        sport: sport.toUpperCase(),
        matchup: matchup(game),
        decision: ready ? "BET" : "SHOP",
        grade: String(rec.tag || "QUALIFIED").toUpperCase(),
        market: rec.market || null,
        pick: rec.pick || null,
        side: rec.side || null,
        line: finite(rec.executionLine ?? rec.line),
        qualificationBook: rec.qualificationBook || rec.benchmarkBook || rec.book || "Pinnacle",
        qualificationPrice,
        executionBook: rec.executionBook || null,
        executionPrice,
        modelProbability,
        marketNoVigProbability: finite(rec.marketNoVigProbability ?? rec.implied),
        probabilityEdgePp: finite(rec.probEdge),
        expectedRoi: qualificationEv,
        executionRoi: executionEv,
        minimumAcceptableOdds: minOdds,
        suggestedUnits: ready ? 1 : 0,
        modelVersion: rec.modelVersion || game.modelVersion || game.championModel || null,
        checkpoint: checkpoint(game.start),
        status: ready ? "READY" : "SHOP — EXECUTION PRICE REQUIRED",
        reason: ready
          ? "Qualified FBIS edge and executable price clears sport EV floor"
          : executionPrice == null
            ? "Qualified vs reference market; no executable price persisted"
            : `Execution price does not clear ${(minEv*100).toFixed(1)}% EV floor`,
      });
    }

    return json({
      ok:true,
      sport,
      date:resolved.date,
      generatedAt,
      minEv,
      rows,
      actionable:rows.filter((r)=>r.status==="READY").length,
      shop:rows.filter((r)=>r.decision==="SHOP").length,
    });
  } catch (err) {
    return json({ ok:false, sport, date:resolved.date, error:String(err?.message || err), rows:[] }, 502);
  }
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"private, no-store, max-age=0",
    },
  });
}
