import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { cbbdGet } from "../lib/collegeApi.js";

const KENPOM_BASE = "https://kenpom.com/api.php";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function kenpomArchive(env, { date = null, endingSeason = null, preseason = false } = {}) {
  const key = String(env.KENPOM_API_KEY || "").trim();
  if (!key) return { ok:false, error:"kenpom-key-missing", rows:[] };
  const url = new URL(KENPOM_BASE);
  url.searchParams.set("endpoint","archive");
  if (preseason) {
    url.searchParams.set("preseason","true");
    url.searchParams.set("y",String(endingSeason));
  } else {
    url.searchParams.set("d",String(date));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization:`Bearer ${key}`, Accept:"application/json", "User-Agent":"FBIS-CBB/2.2" },
  });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok || !Array.isArray(body)) return { ok:false, httpStatus:res.status, error:`kenpom-http-${res.status}`, rows:[] };
  const rows = body.map((r)=>({
    date: r.ArchiveDate ?? date ?? null,
    season: num(r.Season),
    preseason: String(r.Preseason || "").toLowerCase() === "true",
    team: r.TeamName ?? null,
    conference: r.ConfShort ?? null,
    adjEm: num(r.AdjEM),
    adjOe: num(r.AdjOE),
    adjDe: num(r.AdjDE),
    adjTempo: num(r.AdjTempo),
  })).filter(r=>r.team && r.adjOe != null && r.adjDe != null && r.adjTempo != null);
  return { ok:true, httpStatus:res.status, rows, n:rows.length, date, endingSeason, preseason };
}

async function cbbGames(env, { season, start, end } = {}) {
  const query = {
    season: Number(season) + 1,
    startDateRange: start,
    endDateRange: end,
  };
  const res = await cbbdGet("/games", env, { query });
  if (!res.ok) return { ok:false, error:res.reason || "cbbd-games-failed", httpStatus:res.status || 0, rows:[] };
  const rows = (res.data || []).map(g=>({
    id: String(g.id ?? g.gameId ?? g.game_id ?? ""),
    season: Number(g.season ?? season),
    startDate: g.startDate ?? g.start_date ?? g.date ?? null,
    neutralSite: Boolean(g.neutralSite ?? g.neutral_site ?? g.neutral),
    homeTeam: g.homeTeam?.school ?? g.homeTeam?.name ?? g.homeTeam ?? g.home?.school ?? g.home?.name ?? g.home_team ?? null,
    awayTeam: g.awayTeam?.school ?? g.awayTeam?.name ?? g.awayTeam ?? g.away?.school ?? g.away?.name ?? g.away_team ?? null,
    homePoints: num(g.homePoints ?? g.home_points ?? g.homeScore ?? g.home_score),
    awayPoints: num(g.awayPoints ?? g.away_points ?? g.awayScore ?? g.away_score),
    homeEloStart: num(g.homeTeamEloStart ?? g.home_elo_start),
    awayEloStart: num(g.awayTeamEloStart ?? g.away_elo_start),
  })).filter(g=>g.id && g.startDate && g.homeTeam && g.awayTeam && g.homePoints != null && g.awayPoints != null);
  return { ok:true, rows, n:rows.length };
}

function firstNum(obj, keys = []) {
  for (const key of keys) {
    const value = key.split(".").reduce((acc, part) => acc == null ? null : acc[part], obj);
    const n = num(value);
    if (n != null) return n;
  }
  return null;
}

function firstText(obj, keys = []) {
  for (const key of keys) {
    const value = key.split(".").reduce((acc, part) => acc == null ? null : acc[part], obj);
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

async function cbbLines(env, { season } = {}) {
  const res = await cbbdGet("/lines", env, { query: { season: Number(season) + 1 } });
  if (!res.ok) return { ok:false, error:res.reason || "cbbd-lines-failed", httpStatus:res.status || 0, rows:[] };
  const rows = [];
  for (const game of res.data || []) {
    const gameId = String(game.id ?? game.gameId ?? game.game_id ?? "");
    const base = {
      gameId,
      season: Number(game.season ?? Number(season) + 1),
      startDate: game.startDate ?? game.start_date ?? game.date ?? null,
      homeTeam: game.homeTeam?.school ?? game.homeTeam?.name ?? game.homeTeam ?? game.home?.school ?? game.home?.name ?? game.home_team ?? null,
      awayTeam: game.awayTeam?.school ?? game.awayTeam?.name ?? game.awayTeam ?? game.away?.school ?? game.away?.name ?? game.away_team ?? null,
    };
    const lineRows = Array.isArray(game.lines) ? game.lines : Array.isArray(game.providers) ? game.providers : [game];
    for (const line of lineRows) {
      const provider = firstText(line, ["provider","providerName","sportsbook","book","name"]) || firstText(game, ["provider","providerName"]);
      const spread = firstNum(line, ["spread","homeSpread","home_spread","pointSpread","point_spread"]);
      const openingSpread = firstNum(line, ["spreadOpen","openingSpread","openSpread","opening_spread","spread_open"]);
      const overUnder = firstNum(line, ["overUnder","over_under","total","totalPoints","total_points"]);
      const openingOverUnder = firstNum(line, ["overUnderOpen","openingOverUnder","openOverUnder","opening_total","over_under_open"]);
      const homeMoneyline = firstNum(line, ["homeMoneyline","homeMoneyLine","home_moneyline","home_money_line"]);
      const awayMoneyline = firstNum(line, ["awayMoneyline","awayMoneyLine","away_moneyline","away_money_line"]);
      const homeSpreadPrice = firstNum(line, ["homeSpreadPrice","homeSpreadOdds","home_spread_price","home_spread_odds","spreadPrice","spreadOdds"]);
      const awaySpreadPrice = firstNum(line, ["awaySpreadPrice","awaySpreadOdds","away_spread_price","away_spread_odds"]);
      const overPrice = firstNum(line, ["overPrice","overOdds","over_price","over_odds"]);
      const underPrice = firstNum(line, ["underPrice","underOdds","under_price","under_odds"]);
      if (!gameId || (spread == null && overUnder == null && openingSpread == null && openingOverUnder == null)) continue;
      rows.push({
        ...base,
        provider,
        spread,
        openingSpread,
        overUnder,
        openingOverUnder,
        homeMoneyline,
        awayMoneyline,
        homeSpreadPrice,
        awaySpreadPrice,
        overPrice,
        underPrice,
        sampleFields:Object.keys(line || {}).sort().slice(0,40),
      });
    }
  }
  return { ok:true, rows, n:rows.length };
}

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(auth.reason),403);
  const url = new URL(context.request.url);
  const kind = String(url.searchParams.get("kind") || "");
  const env = { KENPOM_API_KEY:context.env.KENPOM_API_KEY, CFBD_API_KEY:context.env.CFBD_API_KEY, CBBD_API_KEY:context.env.CBBD_API_KEY, caches:caches.default };
  if (kind === "kenpom-archive") {
    const date = url.searchParams.get("date") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ok:false,error:"valid-date-required"},400);
    return json(await kenpomArchive(env,{date}));
  }
  if (kind === "kenpom-preseason") {
    const endingSeason = Number(url.searchParams.get("season"));
    if (!Number.isFinite(endingSeason)) return json({ok:false,error:"season-required"},400);
    return json(await kenpomArchive(env,{endingSeason,preseason:true}));
  }
  if (kind === "games") {
    const season = Number(url.searchParams.get("season"));
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if (!Number.isFinite(season) || !start || !end) return json({ok:false,error:"season-start-end-required"},400);
    return json(await cbbGames(env,{season,start,end}));
  }
  if (kind === "lines") {
    const season = Number(url.searchParams.get("season"));
    if (!Number.isFinite(season)) return json({ok:false,error:"season-required"},400);
    return json(await cbbLines(env,{season}));
  }
  return json({ok:false,error:"kind-required",kinds:["games","lines","kenpom-archive","kenpom-preseason"]},400);
}
