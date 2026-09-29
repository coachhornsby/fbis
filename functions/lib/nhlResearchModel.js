/**
 * NHL independent research baseline.
 *
 * Purpose: produce a market-independent opening-season score prior that can
 * display, freeze and grade while qualification / wager authority remain off.
 *
 * Inputs: official NHL team season summary statistics only. No sportsbook
 * lines are used in the projection.
 */

export const NHL_RESEARCH_MODEL_ID = "NHL-FBIS-PURE";
export const NHL_RESEARCH_MODEL_VERSION = "research-v0-team-prior";

const NHL_STATS_BASE = "https://api.nhle.com/stats/rest/en/team/summary";
const HOME_GOAL_PRIOR = 0.12;
const SHRINK_TO_LEAGUE = 0.20;

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

function seasonIds(date) {
  const d = new Date(String(date || "") + "T12:00:00Z");
  const y = Number.isFinite(d.getTime()) ? d.getUTCFullYear() : new Date().getUTCFullYear();
  const m = Number.isFinite(d.getTime()) ? d.getUTCMonth() + 1 : new Date().getUTCMonth() + 1;
  const startYear = m >= 7 ? y : y - 1;
  const current = Number(`${startYear}${startYear + 1}`);
  const prior = Number(`${startYear - 1}${startYear}`);
  return { current, prior };
}

function statUrl(seasonId) {
  const exp = encodeURIComponent(`seasonId=${seasonId} and gameTypeId=2`);
  return `${NHL_STATS_BASE}?isAggregate=false&isGame=false&start=0&limit=100&cayenneExp=${exp}`;
}

function normTeamName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rowAbbr(row = {}, teamLookup = null) {
  const direct = String(
    row.teamAbbrev ||
    row.teamAbbreviation ||
    row.teamTriCode ||
    row.triCode ||
    row.rawTricode ||
    ""
  ).trim().toUpperCase();
  if (direct) return direct;
  const byId = row.teamId != null ? teamLookup?.byId?.get(String(row.teamId)) : null;
  if (byId) return byId;
  return teamLookup?.byName?.get(normTeamName(row.teamFullName || row.teamName || row.team)) || "";
}

function normalizeRow(row = {}, teamLookup = null) {
  const gp = finite(row.gamesPlayed);
  const gf = finite(row.goalsFor);
  const ga = finite(row.goalsAgainst);
  const gfpg = finite(row.goalsForPerGame) ?? (gp && gf != null ? gf / gp : null);
  const gapg = finite(row.goalsAgainstPerGame) ?? (gp && ga != null ? ga / gp : null);
  if (!rowAbbr(row, teamLookup) || !gp || gfpg == null || gapg == null) return null;
  return {
    abbr: rowAbbr(row, teamLookup),
    team: row.teamFullName || row.teamName || row.team || rowAbbr(row, teamLookup),
    gamesPlayed: gp,
    goalsForPerGame: gfpg,
    goalsAgainstPerGame: gapg,
    powerPlayPct: finite(row.powerPlayPct),
    penaltyKillPct: finite(row.penaltyKillPct),
    shotsForPerGame: finite(row.shotsForPerGame),
    shotsAgainstPerGame: finite(row.shotsAgainstPerGame),
  };
}

async function fetchJson(url, fetcher = fetch) {
  const res = await fetcher(url, {
    headers: {
      accept: "application/json",
      "user-agent": "FBIS/1.0",
    },
  });
  if (!res.ok) throw new Error(`NHL_STATS_HTTP_${res.status}`);
  return res.json();
}

export async function loadNhlResearchPrior(date, { fetcher = fetch } = {}) {
  const ids = seasonIds(date);
  const [json, teamJson] = await Promise.all([
    fetchJson(statUrl(ids.prior), fetcher),
    fetchJson("https://api.nhle.com/stats/rest/en/team?limit=-1", fetcher),
  ]);
  const byId = new Map();
  const byName = new Map();
  for (const team of teamJson?.data || []) {
    const abbr = String(team.rawTricode || team.triCode || "").trim().toUpperCase();
    if (!abbr) continue;
    if (team.id != null) byId.set(String(team.id), abbr);
    const full = normTeamName(team.fullName);
    if (full) byName.set(full, abbr);
  }
  const teamLookup = { byId, byName };
  const rows = (json?.data || []).map((row) => normalizeRow(row, teamLookup)).filter(Boolean);
  const byAbbr = Object.fromEntries(rows.map((r) => [r.abbr, r]));
  const leagueAvgGoals = rows.length
    ? rows.reduce((s, r) => s + r.goalsForPerGame, 0) / rows.length
    : null;
  return {
    ok: rows.length >= 20 && Number.isFinite(leagueAvgGoals),
    modelId: NHL_RESEARCH_MODEL_ID,
    modelVersion: NHL_RESEARCH_MODEL_VERSION,
    source: "NHL_STATS_TEAM_SUMMARY",
    sourceUrl: NHL_STATS_BASE,
    seasonId: ids.prior,
    teams: rows.length,
    leagueAvgGoals: leagueAvgGoals == null ? null : round2(leagueAvgGoals),
    byAbbr,
    marketInformed: false,
    canQualify: false,
    canAuthorize: false,
  };
}

export function projectNhlResearchGame(game, prior) {
  if (!prior?.ok) return { ok: false, reason: "nhl-prior-unavailable" };
  const homeAbbr = String(game?.home?.abbr || "").toUpperCase();
  const awayAbbr = String(game?.away?.abbr || "").toUpperCase();
  const h = prior.byAbbr?.[homeAbbr];
  const a = prior.byAbbr?.[awayAbbr];
  if (!h || !a) {
    return {
      ok: false,
      reason: "nhl-team-prior-missing",
      homeAbbr,
      awayAbbr,
    };
  }

  const lg = Number(prior.leagueAvgGoals);
  const homeRaw = (h.goalsForPerGame + a.goalsAgainstPerGame) / 2;
  const awayRaw = (a.goalsForPerGame + h.goalsAgainstPerGame) / 2;
  const home = (1 - SHRINK_TO_LEAGUE) * homeRaw + SHRINK_TO_LEAGUE * lg + HOME_GOAL_PRIOR;
  const away = (1 - SHRINK_TO_LEAGUE) * awayRaw + SHRINK_TO_LEAGUE * lg;

  return {
    ok: true,
    modelId: NHL_RESEARCH_MODEL_ID,
    modelVersion: NHL_RESEARCH_MODEL_VERSION,
    home: round2(home),
    away: round2(away),
    margin: round2(home - away),
    total: round2(home + away),
    homeAbbr,
    awayAbbr,
    seasonId: prior.seasonId,
    source: prior.source,
    independent: true,
    marketInformed: false,
    goalieAdjusted: false,
    specialTeamsMode: "DESCRIPTIVE_ONLY",
    homeInputs: h,
    awayInputs: a,
    leagueAvgGoals: lg,
    canQualify: false,
    canAuthorize: false,
    maturity: "RESEARCH",
    note:
      "Opening-season independent team prior from previous regular-season scoring/defense, shrunk to league average. Goalie and current-season 5v5 xG layers are not yet active.",
  };
}

export function attachNhlResearch(games = [], prior = null) {
  let projected = 0;
  let missing = 0;
  const next = (games || []).map((game) => {
    const proj = projectNhlResearchGame(game, prior);
    if (proj.ok) projected += 1;
    else missing += 1;
    return {
      ...game,
      nhlResearch: proj,
      challengers: {
        ...(game.challengers || {}),
        [NHL_RESEARCH_MODEL_ID]: proj,
      },
    };
  });
  return {
    games: next,
    meta: {
      modelId: NHL_RESEARCH_MODEL_ID,
      modelVersion: NHL_RESEARCH_MODEL_VERSION,
      source: prior?.source || "NHL_STATS_TEAM_SUMMARY",
      seasonId: prior?.seasonId || null,
      projected,
      missing,
      independent: true,
      marketInformed: false,
      canQualify: false,
      canAuthorize: false,
      maturity: "RESEARCH",
    },
  };
}
