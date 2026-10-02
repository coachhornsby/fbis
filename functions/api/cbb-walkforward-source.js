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
    season: Number(season),
    startDateRange: start,
    endDateRange: end,
  };
  const res = await cbbdGet("/games", env, { query });
  if (!res.ok) return { ok:false, error:res.reason || "cbbd-games-failed", httpStatus:res.status || 0, rows:[] };
  const rows = (res.data || []).filter(g=>g.status === "final" || (g.homePoints != null && g.awayPoints != null)).map(g=>({
    id: String(g.id),
    season: Number(g.season),
    startDate: g.startDate,
    neutralSite: Boolean(g.neutralSite),
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    homePoints: num(g.homePoints),
    awayPoints: num(g.awayPoints),
    homeEloStart: num(g.homeTeamEloStart),
    awayEloStart: num(g.awayTeamEloStart),
  })).filter(g=>g.startDate && g.homeTeam && g.awayTeam && g.homePoints != null && g.awayPoints != null);
  return { ok:true, rows, n:rows.length };
}

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(auth.reason),403);
  const url = new URL(context.request.url);
  const kind = String(url.searchParams.get("kind") || "");
  const env = { KENPOM_API_KEY:context.env.KENPOM_API_KEY, CBBD_API_KEY:context.env.CBBD_API_KEY, caches:caches.default };
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
  return json({ok:false,error:"kind-required",kinds:["games","kenpom-archive","kenpom-preseason"]},400);
}
