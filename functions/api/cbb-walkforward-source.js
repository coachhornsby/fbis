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

async function cbbLines(env, { season, start = null, end = null } = {}) {
  const query = { season: Number(season) + 1 };
  if (start) query.startDateRange = start;
  if (end) query.endDateRange = end;
  const res = await cbbdGet("/lines", env, { query });
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


async function cbbTeamMeta(env, { season } = {}) {
  const query = { year: Number(season) + 1 };
  const res = await cbbdGet("/ratings/adjusted", env, { query });
  if (!res.ok) return { ok:false, error:res.reason || "cbbd-team-meta-failed", httpStatus:res.status || 0, rows:[] };
  const rows = (res.data || []).map(r => ({
    team: r.team?.school ?? r.team?.name ?? r.team ?? r.school ?? r.name ?? null,
    conference: r.conference?.abbreviation ?? r.conference?.name ?? r.conference ?? r.conf ?? null,
  })).filter(r => r.team);
  return { ok:true, rows, n:rows.length };
}

async function cbbGameTeams(env, { season, start = null, end = null } = {}) {
  const query = { season: Number(season) + 1 };
  if (start) query.startDateRange = start;
  if (end) query.endDateRange = end;
  const res = await cbbdGet("/games/teams", env, { query });
  if (!res.ok) return { ok:false, error:res.reason || "cbbd-game-teams-failed", httpStatus:res.status || 0, rows:[] };
  const rows = (res.data || []).map((r) => {
    const s = r.teamStats ?? r.team_stats ?? {};
    const o = r.opponentStats ?? r.opponent_stats ?? {};
    const fg = s.fieldGoals ?? s.field_goals ?? {};
    const two = s.twoPointFieldGoals ?? s.two_point_field_goals ?? {};
    const three = s.threePointFieldGoals ?? s.three_point_field_goals ?? {};
    const ft = s.freeThrows ?? s.free_throws ?? {};
    const reb = s.rebounds ?? {};
    const ff = s.fourFactors ?? s.four_factors ?? {};
    const offReb = num(reb.offensive);
    const oppDefReb = num((o.rebounds ?? {}).defensive);
    return {
      gameId:String(r.gameId ?? r.game_id ?? ""),
      season:num(r.season),
      startDate:r.startDate ?? r.start_date ?? null,
      team:r.team ?? null,
      opponent:r.opponent ?? null,
      neutralSite:Boolean(r.neutralSite ?? r.neutral_site),
      isHome:Boolean(r.isHome ?? r.is_home),
      pace:num(r.pace),
      possessions:num(s.possessions),
      fgm:num(fg.made), fga:num(fg.attempted),
      twoMade:num(two.made), twoAtt:num(two.attempted),
      threeMade:num(three.made), threeAtt:num(three.attempted),
      ftm:num(ft.made), fta:num(ft.attempted),
      orb:offReb, drb:num(reb.defensive),
      turnovers:num((s.turnovers ?? {}).total),
      efgPct:num(ff.effectiveFieldGoalPct ?? ff.effective_field_goal_pct),
      orbRate:num(ff.offensiveReboundPct ?? ff.offensive_rebound_pct) ?? (offReb != null && oppDefReb != null && offReb + oppDefReb > 0 ? 100 * offReb / (offReb + oppDefReb) : null),
      tovRate:num(ff.turnoverRatio ?? ff.turnover_ratio),
      ftr:num(ff.freeThrowRate ?? ff.free_throw_rate),
    };
  }).filter(r=>r.gameId && r.startDate && r.team);
  return {ok:true,rows,n:rows.length};
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
  if (kind === "game-teams") {
    const season = Number(url.searchParams.get("season"));
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if (!Number.isFinite(season)) return json({ok:false,error:"season-required"},400);
    return json(await cbbGameTeams(env,{season,start,end}));
  }
  if (kind === "team-meta") {
    const season = Number(url.searchParams.get("season"));
    if (!Number.isFinite(season)) return json({ok:false,error:"season-required"},400);
    return json(await cbbTeamMeta(env,{season}));
  }
  if (kind === "lines") {
    const season = Number(url.searchParams.get("season"));
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if (!Number.isFinite(season)) return json({ok:false,error:"season-required"},400);
    return json(await cbbLines(env,{season,start,end}));
  }
  return json({ok:false,error:"kind-required",kinds:["games","game-teams","team-meta","lines","kenpom-archive","kenpom-preseason"]},400);
}
