/**
 * Canonical CFBD ingestion layer.
 * One fetch path → normalized records → feature store → game + player models.
 * Refresh frequency groups avoid re-fetching static seasonal data per game.
 */

import { cfbdGet } from "./collegeApi.js";
import { TEMPORAL_CLASS } from "./cfbFeaturePipeline.js";

export const CANONICAL_VERSION = "cfbd-canonical-v1";

/** Endpoint refresh cadence for cost control. */
export const REFRESH_CADENCE = {
  SEASONAL: "seasonal",
  WEEKLY: "weekly",
  GAME_DAY: "game-day",
};

export const ENDPOINT_CADENCE = {
  "/talent": REFRESH_CADENCE.SEASONAL,
  "/recruiting/teams": REFRESH_CADENCE.SEASONAL,
  "/player/returning": REFRESH_CADENCE.SEASONAL,
  "/player/portal": REFRESH_CADENCE.SEASONAL,
  "/roster": REFRESH_CADENCE.SEASONAL,
  "/coaches": REFRESH_CADENCE.SEASONAL,
  "/ratings/sp": REFRESH_CADENCE.SEASONAL, // prior-season freeze only for historical
  "/ratings/fpi": REFRESH_CADENCE.SEASONAL,
  "/ratings/srs": REFRESH_CADENCE.SEASONAL,
  "/ratings/elo": REFRESH_CADENCE.SEASONAL,
  "/venues": REFRESH_CADENCE.SEASONAL,
  "/ratings/core": REFRESH_CADENCE.WEEKLY, // throughWeek / throughSeasonType
  "/ppa/teams": REFRESH_CADENCE.WEEKLY,
  "/ppa/games": REFRESH_CADENCE.WEEKLY,
  "/stats/season/advanced": REFRESH_CADENCE.WEEKLY,
  "/stats/game/advanced": REFRESH_CADENCE.WEEKLY,
  "/ppa/players/season": REFRESH_CADENCE.WEEKLY,
  "/ppa/players/games": REFRESH_CADENCE.WEEKLY,
  "/player/usage": REFRESH_CADENCE.WEEKLY,
  "/stats/player/season": REFRESH_CADENCE.WEEKLY,
  "/games": REFRESH_CADENCE.WEEKLY,
  "/drives": REFRESH_CADENCE.WEEKLY,
  "/plays": REFRESH_CADENCE.WEEKLY,
  "/roster": REFRESH_CADENCE.GAME_DAY, // late starter changes when available
  "/games/weather": REFRESH_CADENCE.GAME_DAY,
  "/scoreboard": REFRESH_CADENCE.GAME_DAY,
  "/lines": REFRESH_CADENCE.GAME_DAY, // evaluation only
};

/** In-memory season/week cache keyed by cadence bucket — never fan out from customer pages. */
const _bundleCache = new Map();

function cacheKey(parts) {
  return parts.filter((p) => p != null && p !== "").join("|");
}

export function clearCanonicalCache() {
  _bundleCache.clear();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function schoolKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize CORE ratings row — prefer week-bounded throughWeek fields.
 */
export function normalizeCoreRating(row = {}) {
  return {
    team: row.team || row.school || null,
    conference: row.conference || null,
    season: num(row.year ?? row.season),
    throughWeek: num(row.throughWeek ?? row.week),
    throughSeasonType: row.throughSeasonType || row.seasonType || null,
    rating: num(row.rating ?? row.overall),
    offense: num(row.offense?.rating ?? row.offense),
    defense: num(row.defense?.rating ?? row.defense),
    specialTeams: num(row.specialTeams?.rating ?? row.specialTeams),
    temporalClass: TEMPORAL_CLASS.B,
    sourceEndpoint: "/ratings/core",
  };
}

/**
 * Select CORE rows with throughWeek strictly before target week (or equal if asOfWeek inclusive false).
 * Prefer the latest throughWeek still ≤ maxWeek.
 */
export function selectCoreThroughWeek(rows = [], { team = null, maxWeek = null, seasonType = "regular" } = {}) {
  const teamKey = team ? schoolKey(team) : null;
  const filtered = (rows || [])
    .map(normalizeCoreRating)
    .filter((r) => {
      if (teamKey && schoolKey(r.team) !== teamKey) return false;
      if (seasonType && r.throughSeasonType && String(r.throughSeasonType).toLowerCase() !== String(seasonType).toLowerCase()) {
        // Allow undated rows through if season type missing
        if (r.throughSeasonType) return false;
      }
      if (maxWeek == null) return true;
      if (r.throughWeek == null) return false; // undated same-season CORE rejected for historical
      return r.throughWeek <= maxWeek;
    });
  if (!filtered.length) return null;
  filtered.sort((a, b) => (b.throughWeek || 0) - (a.throughWeek || 0));
  return filtered[0];
}

/**
 * Build index of best CORE rating per team for a week bound.
 */
export function indexCoreByTeam(rows = [], { maxWeek = null, seasonType = "regular" } = {}) {
  const byTeam = {};
  for (const row of rows || []) {
    const norm = normalizeCoreRating(row);
    if (!norm.team) continue;
    if (maxWeek != null && (norm.throughWeek == null || norm.throughWeek > maxWeek)) continue;
    if (
      seasonType &&
      norm.throughSeasonType &&
      String(norm.throughSeasonType).toLowerCase() !== String(seasonType).toLowerCase()
    ) {
      continue;
    }
    const key = schoolKey(norm.team);
    const prev = byTeam[key];
    if (!prev || (norm.throughWeek || 0) > (prev.throughWeek || 0)) {
      byTeam[key] = norm;
    }
  }
  return byTeam;
}

async function getPath(env, path, query, { entitled = null, fetchFn = fetch, skipCache = false } = {}) {
  if (entitled && !entitled.has(path) && !entitled.has("*")) {
    return { ok: false, path, data: [], skipped: true, reason: "not-entitled", cadence: ENDPOINT_CADENCE[path] || null };
  }
  const res = await cfbdGet(path, env, { query, fetchFn, skipCache });
  return {
    ok: res.ok,
    path,
    data: res.ok ? res.data || [] : [],
    status: res.status,
    reason: res.reason,
    cadence: ENDPOINT_CADENCE[path] || null,
  };
}

/**
 * Fetch seasonal (low-frequency) bundle once per season.
 */
export async function fetchSeasonalBundle(env, season, opts = {}) {
  const key = cacheKey(["seasonal", season, opts.prior ? "prior" : "curr"]);
  if (!opts.skipMemCache && _bundleCache.has(key)) return _bundleCache.get(key);

  const g = (path, query) => getPath(env, path, query, opts);
  const [sp, fpi, srs, elo, talent, returning, recruiting, portal, coaches, venues] = await Promise.all([
    g("/ratings/sp", { year: season }),
    g("/ratings/fpi", { year: season }),
    g("/ratings/srs", { year: season }),
    g("/ratings/elo", { year: season }),
    g("/talent", { year: season }),
    g("/player/returning", { year: season }),
    g("/recruiting/teams", { year: season }),
    g("/player/portal", { year: season }),
    g("/coaches", { year: season }),
    g("/venues", {}),
  ]);

  const bundle = {
    cadence: REFRESH_CADENCE.SEASONAL,
    season,
    collectedAt: new Date().toISOString(),
    canonicalVersion: CANONICAL_VERSION,
    endpoints: { sp, fpi, srs, elo, talent, returning, recruiting, portal, coaches, venues },
  };
  _bundleCache.set(key, bundle);
  return bundle;
}

/**
 * Fetch weekly bundle including week-bounded CORE.
 */
export async function fetchWeeklyBundle(env, season, week, opts = {}) {
  const key = cacheKey(["weekly", season, week, opts.seasonType || "regular"]);
  if (!opts.skipMemCache && _bundleCache.has(key)) return _bundleCache.get(key);

  const seasonType = opts.seasonType || "regular";
  const g = (path, query) => getPath(env, path, query, opts);
  const throughWeek = week == null ? null : Math.max(0, Number(week) - 1);

  const [
    core,
    ppaTeams,
    ppaGames,
    advGames,
    advSeason,
    qbPpa,
    rbPpa,
    wrPpa,
    usage,
    playerSeason,
    games,
    roster,
  ] = await Promise.all([
    // CORE: request season; filter client-side by throughWeek ≤ week-1 for pregame
    g("/ratings/core", { year: season }),
    g("/ppa/teams", { year: season, seasonType }),
    week != null ? g("/ppa/games", { year: season, week, seasonType }) : Promise.resolve({ ok: false, path: "/ppa/games", data: [] }),
    week != null ? g("/stats/game/advanced", { year: season, week, seasonType }) : Promise.resolve({ ok: false, path: "/stats/game/advanced", data: [] }),
    g("/stats/season/advanced", { year: season }),
    g("/ppa/players/season", { year: season, position: "QB" }),
    g("/ppa/players/season", { year: season, position: "RB" }),
    g("/ppa/players/season", { year: season, position: "WR" }),
    g("/player/usage", { year: season }),
    g("/stats/player/season", { year: season }),
    week != null ? g("/games", { year: season, week, seasonType }) : g("/games", { year: season, seasonType }),
    g("/roster", { year: season }),
  ]);

  const coreIndexed = indexCoreByTeam(core.data || [], {
    maxWeek: throughWeek,
    seasonType,
  });

  const bundle = {
    cadence: REFRESH_CADENCE.WEEKLY,
    season,
    week,
    throughWeek,
    seasonType,
    collectedAt: new Date().toISOString(),
    canonicalVersion: CANONICAL_VERSION,
    coreByTeam: coreIndexed,
    endpoints: {
      core,
      ppaTeams,
      ppaGames,
      advGames,
      advSeason,
      qbPpa,
      rbPpa,
      wrPpa,
      usage,
      playerSeason,
      games,
      roster,
    },
  };
  _bundleCache.set(key, bundle);
  return bundle;
}

/**
 * Game-day bundle: weather, scoreboard, lines (eval), optional late roster.
 */
export async function fetchGameDayBundle(env, season, week, opts = {}) {
  const key = cacheKey(["gameday", season, week, opts.seasonType || "regular"]);
  if (!opts.skipMemCache && _bundleCache.has(key)) return _bundleCache.get(key);

  const seasonType = opts.seasonType || "regular";
  const g = (path, query) => getPath(env, path, query, opts);
  const [weather, scoreboard, lines] = await Promise.all([
    week != null ? g("/games/weather", { year: season, week, seasonType }) : g("/games/weather", { year: season }),
    g("/scoreboard", { year: season, week, seasonType }),
    week != null ? g("/lines", { year: season, week, seasonType }) : g("/lines", { year: season }),
  ]);

  const bundle = {
    cadence: REFRESH_CADENCE.GAME_DAY,
    season,
    week,
    seasonType,
    collectedAt: new Date().toISOString(),
    canonicalVersion: CANONICAL_VERSION,
    endpoints: { weather, scoreboard, lines },
    evaluationOnly: ["lines"],
  };
  _bundleCache.set(key, bundle);
  return bundle;
}

/**
 * Compose full research bundle for a season/week without duplicating seasonal fetches.
 */
export async function fetchCanonicalWeekBundle(env, season, week, opts = {}) {
  const priorSeason = Number(season) - 1;
  const [seasonalPrior, seasonalCurr, weekly, gameDay] = await Promise.all([
    fetchSeasonalBundle(env, priorSeason, { ...opts, prior: true }),
    fetchSeasonalBundle(env, season, opts),
    fetchWeeklyBundle(env, season, week, opts),
    fetchGameDayBundle(env, season, week, opts),
  ]);
  return {
    canonicalVersion: CANONICAL_VERSION,
    season,
    week,
    collectedAt: new Date().toISOString(),
    seasonalPrior,
    seasonalCurr,
    weekly,
    gameDay,
    requestEstimate: estimateRequestCount({ includePrior: true, includeGameDay: true, weeks: 1 }),
  };
}

/**
 * Rough CFBD request budget for planning (one path = one request).
 */
export function estimateRequestCount({
  seasons = 1,
  weeks = 15,
  includePrior = true,
  includeGameDay = true,
  includePlayerPpaPositions = 3,
} = {}) {
  const seasonalPaths = 10; // sp fpi srs elo talent returning recruiting portal coaches venues
  const weeklyFixed = 6 + includePlayerPpaPositions; // core ppaTeams advSeason usage playerSeason roster + QB/RB/WR ppa
  const weeklyPerWeek = 3; // ppaGames advGames games
  const gameDayPerWeek = includeGameDay ? 3 : 0; // weather scoreboard lines
  const priorCost = includePrior ? seasonalPaths : 0;
  const seasonalCost = seasons * seasonalPaths + priorCost;
  const weeklyCost = seasons * (weeklyFixed + weeks * (weeklyPerWeek + gameDayPerWeek));
  return {
    seasonal: seasonalCost,
    weekly: weeklyCost,
    perWeekSteadyState: weeklyFixed / Math.max(1, weeks) + weeklyPerWeek + gameDayPerWeek,
    historicalBackfillSeasons4: {
      note: "2022-2025 × ~15 weeks; prior season once each",
      estimate: 4 * (seasonalPaths + seasonalPaths + weeklyFixed + 15 * (weeklyPerWeek + gameDayPerWeek)),
    },
    customerPageFanout: 0,
  };
}

export { schoolKey, num };
