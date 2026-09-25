import { buildSlate, resolveSlateDate, shiftDateCT, todayCT } from "../lib/slateEngine.js";

const SPORTS = new Set(["cfb","nfl","mlb"]);

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function dateCt(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago", year:"numeric", month:"2-digit", day:"2-digit"
    }).format(new Date(iso));
  } catch { return String(iso).slice(0,10); }
}

function timeCt(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", hour:"numeric", minute:"2-digit", hour12:true
    }).format(new Date(iso));
  } catch { return iso; }
}

function dedupe(games = []) {
  const seen = new Map();
  for (const g of games) {
    const away = String(g?.away?.abbr || g?.away?.name || "").toUpperCase();
    const home = String(g?.home?.abbr || g?.home?.name || "").toUpperCase();
    const day = dateCt(g?.start);
    const key = [day,away,home].join("|");
    const independent = g?.projectionKind === "FBIS" || g?.model?.projectionKind === "FBIS";
    const score = independent ? 10 : 0;
    const prior = seen.get(key);
    if (!prior || score > prior.score) seen.set(key,{score,game:g});
  }
  return [...seen.values()].map(x=>x.game);
}

function row(game, sport) {
  const projHome = Number(game?.model?.projHome ?? game?.projHome ?? game?.projHomeScore);
  const projAway = Number(game?.model?.projAway ?? game?.projAway ?? game?.projAwayScore);
  const independent = (game?.projectionKind === "FBIS" || game?.model?.projectionKind === "FBIS") &&
    Number.isFinite(projHome) && Number.isFinite(projAway);
  const modelId = game?.researchProjection?.modelId || game?.projectionEngine ||
    (sport === "cfb" ? "CFB-FBIS-v2" : sport === "nfl" ? "NFL-FBIS-PURE" : "FBIS-MLB");
  const maturity = String(game?.projectionMaturity || game?.model?.maturity ||
    (sport === "nfl" ? "RESEARCH" : "PRODUCTION")).toUpperCase();
  const sourcePrimary = sport === "cfb" ? "CFBD" : sport === "nfl" ? "nflverse + team form" : "MLB Stats / Savant";
  const sourceSecondary = sport === "cfb" ? "context / roster / weather" : sport === "nfl" ? "ESPN context" : "starter / bullpen context";
  const state = independent ? (maturity === "RESEARCH" ? "RESEARCH" : "PROJECTION") : "NO MODEL";
  return [
    String(game?.id || ""),
    dateCt(game?.start),
    timeCt(game?.start),
    game?.away?.abbr || game?.away?.name || "",
    game?.home?.abbr || game?.home?.name || "",
    game?.neutralSite ? "NEUTRAL" : (game?.venue || ""),
    sourcePrimary,
    "LIVE",
    sourceSecondary,
    "LIVE",
    game?.researchProjection?.informationCutoff || game?.cfb?.priorAsOf || "",
    game?.researchProjection?.featureSnapshotId || "",
    independent ? "NATIVE LOCKED" : "NO",
    modelId,
    independent ? projAway : "",
    independent ? projHome : "",
    "","","","","","",
    independent ? Math.round((projAway + projHome) * 1000) / 1000 : "",
    "","","","",
    maturity,
    state,
    independent ? (maturity === "RESEARCH" ? "Independent research projection; no wager authority" : "Independent FBIS production projection") : "Independent projection unavailable"
  ];
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = String(url.searchParams.get("sport") || "").toLowerCase();
  if (!SPORTS.has(sport)) return new Response("unsupported sport",{status:400});
  const rawStart = url.searchParams.get("date") || todayCT();
  const days = Math.max(1, Math.min(3, Number(url.searchParams.get("days") || 3)));
  const window = sport === "cfb" ? {maxPast:7,maxFuture:14} : {maxPast:2,maxFuture:3};
  const resolved = resolveSlateDate(rawStart, window);
  if (!resolved.ok) return new Response("invalid date",{status:400});

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
  };

  const games = [];
  for (let i=0;i<days;i++) {
    const date = shiftDateCT(resolved.date,i);
    try {
      const slate = await buildSlate(sport,date,env);
      games.push(...(slate.games || []));
    } catch {}
  }

  const rows = dedupe(games)
    .sort((a,b)=>String(a.start||"").localeCompare(String(b.start||"")))
    .map(g=>row(g,sport));
  const body = rows.map(r=>r.map(csvCell).join(",")).join("\n");
  return new Response(body,{
    status:200,
    headers:{
      "content-type":"text/csv; charset=utf-8",
      "cache-control":"public, max-age=300, stale-while-revalidate=600",
      "access-control-allow-origin":"*"
    }
  });
}
