/**
 * MLB bullpen context for the MLB-RUN-ALLOC-v1 shadow.
 * Uses MLB Stats API relief-pitcher split (sitCodes=rp), cached per club.
 * No sportsbook, Ballpark Pal, or market inputs.
 */

import { readCache, writeCache } from "./cache.js";

const TTL_MS = 3 * 60 * 60 * 1000;
const ERR_TTL_MS = 20 * 60 * 1000;

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function seasonYear() { return new Date().getFullYear(); }

export function parseBullpenStat(json = {}) {
  const groups = json.stats || [];
  const splits = groups.flatMap((g) => Array.isArray(g?.splits) ? g.splits : []);
  const stat = splits[0]?.stat || null;
  if (!stat) return null;
  return {
    era: num(stat.era),
    whip: num(stat.whip),
    innings: num(stat.inningsPitched),
    strikeoutsPer9: num(stat.strikeoutsPer9Inn),
    walksPer9: num(stat.walksPer9Inn),
    homeRunsPer9: num(stat.homeRunsPer9),
  };
}

async function loadTeamBullpen(teamId, env = {}, { fetchFn = fetch, season = seasonYear() } = {}) {
  const id = Number(teamId);
  if (!Number.isFinite(id)) return null;
  const cacheKey = `mlb-bullpen-v1:${season}:${id}`;
  const cached = await readCache(cacheKey, env.caches, TTL_MS);
  if (cached) return cached;
  try {
    const qs = new URLSearchParams({ group: "pitching", season: String(season), stats: "statSplits", sitCodes: "rp", gameType: "R" });
    const res = await fetchFn(`https://statsapi.mlb.com/api/v1/teams/${id}/stats?${qs}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`MLB bullpen ${res.status}`);
    const stat = parseBullpenStat(await res.json());
    const payload = stat ? { ...stat, teamId: id, season, source: "MLB Stats relief split", asOf: new Date().toISOString() } : { teamId: id, season, source: "MLB Stats relief split", unavailable: true };
    await writeCache(cacheKey, payload, env.caches, stat?.era != null ? TTL_MS : ERR_TTL_MS);
    return payload;
  } catch (err) {
    const payload = { teamId: id, season, source: "MLB Stats relief split", unavailable: true, error: String(err?.message || err) };
    await writeCache(cacheKey, payload, env.caches, ERR_TTL_MS);
    return payload;
  }
}

export async function loadMlbBullpenContext(games = [], env = {}, options = {}) {
  const ids = [...new Set((games || []).flatMap((g) => [g.home?.mlbId, g.away?.mlbId]).map(Number).filter(Number.isFinite))];
  const entries = await Promise.all(ids.map(async (id) => [String(id), await loadTeamBullpen(id, env, options)]));
  const byTeamId = Object.fromEntries(entries);
  return {
    byTeamId,
    meta: {
      source: "MLB Stats relief split",
      teams: ids.length,
      available: entries.filter(([, v]) => v?.era != null).length,
      cacheTtlMinutes: TTL_MS / 60000,
      marketInformed: false,
    },
  };
}

export function attachMlbBullpenContext(games = [], feed = {}) {
  return (games || []).map((game) => {
    if (game.sport && game.sport !== "mlb") return game;
    const home = feed.byTeamId?.[String(game.home?.mlbId)] || null;
    const away = feed.byTeamId?.[String(game.away?.mlbId)] || null;
    return {
      ...game,
      mlbContext: {
        ...(game.mlbContext || {}),
        homeBullpenEra: home?.era ?? game.mlbContext?.homeBullpenEra ?? null,
        awayBullpenEra: away?.era ?? game.mlbContext?.awayBullpenEra ?? null,
        bullpenSource: "MLB Stats relief split",
        bullpenAsOf: home?.asOf || away?.asOf || null,
      },
    };
  });
}
