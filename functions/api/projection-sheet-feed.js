import { buildSlate, resolveSlateDate, shiftDateCT, todayCT } from "../lib/slateEngine.js";
import { productProjectionCard } from "../lib/productProjection.js";

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
  const card = productProjectionCard(game, sport, { tier: "public" });
  const projHome = Number(card?.projection?.home);
  const projAway = Number(card?.projection?.away);
  const independent = card?.projection?.independent === true && Number.isFinite(projHome) && Number.isFinite(projAway);
  const modelId = card?.modelVersion || game?.researchProjection?.modelId || game?.projectionEngine ||
    (sport === "cfb" ? "CFB-FBIS-v2" : sport === "nfl" ? "NFL-FBIS-PURE" : "FBIS-MLB");
  const maturity = String(card?.model?.maturity || game?.projectionMaturity ||
    (sport === "nfl" ? "RESEARCH" : "PRODUCTION")).toUpperCase();
  const sourcePrimary = sport === "cfb" ? "CFBD" : sport === "nfl" ? "nflverse / team form" : "MLB Stats / Savant";
  const sourceSecondary = sport === "cfb" ? "roster / weather / context" : sport === "nfl" ? "ESPN / QB / context" : "starter / bullpen / context";
  const marketSpread = card?.market?.spread;
  const marketTotal = card?.market?.total;
  const nativeMargin = independent ? projHome - projAway : null;
  const sideDiff = independent && marketSpread != null
    ? Math.round((nativeMargin + Number(marketSpread)) * 10) / 10
    : "";
  const nativeTotal = independent ? projAway + projHome : null;
  const totalDiff = independent && marketTotal != null
    ? Math.round((nativeTotal - Number(marketTotal)) * 10) / 10
    : "";
  const qScore = card?.quality?.score;
  const qState = card?.quality?.state;
  const flags = Array.isArray(card?.quality?.flags) ? card.quality.flags : [];
  const starterHold = sport === "mlb" && flags.some((x) => /missing_(home|away)_sp/i.test(String(x)));
  const state = independent
    ? starterHold
      ? "HOLD — STARTER"
      : maturity === "RESEARCH"
        ? "RESEARCH"
        : "PROJECTION"
    : "NO MODEL";
  const qualityText = [
    qScore != null ? `Q${qScore}` : null,
    qState || null,
    starterHold ? "STARTER HOLD" : null,
  ].filter(Boolean).join(" · ");
  return [
    String(card?.id || game?.id || ""),
    dateCt(card?.start || game?.start),
    timeCt(card?.start || game?.start),
    card?.away?.abbr || game?.away?.abbr || game?.away?.name || "",
    card?.home?.abbr || game?.home?.abbr || game?.home?.name || "",
    card?.neutral ? "NEUTRAL" : (game?.venue || ""),
    sourcePrimary,
    "LIVE",
    sourceSecondary,
    "LIVE",
    game?.researchProjection?.informationCutoff || game?.cfb?.priorAsOf || new Date().toISOString(),
    game?.researchProjection?.featureSnapshotId || "",
    independent ? "NATIVE LOCKED" : "NO",
    modelId,
    independent ? projAway : "",
    independent ? projHome : "",
    "","","","",
    "","",
    independent ? Math.round(nativeTotal * 10) / 10 : "",
    marketSpread ?? "",
    marketTotal ?? "",
    sideDiff,
    totalDiff,
    qualityText || maturity,
    state,
    flags.join(", ") || (independent ? (maturity === "RESEARCH" ? "Independent research projection; no wager authority" : "Independent FBIS projection") : "Independent projection unavailable")
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
      const onDate = (slate.games || []).filter((g) => dateCt(g?.start) === date);
      games.push(...onDate);
    } catch {}
  }

  const rows = dedupe(games)
    .filter((g) => {
      const away = String(g?.away?.abbr || "").trim();
      const home = String(g?.home?.abbr || "").trim();
      return away && home && away !== "—" && home !== "—";
    })
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
