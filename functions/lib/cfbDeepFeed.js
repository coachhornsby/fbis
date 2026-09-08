/**
 * Low-cost CFB matchup enrichment sourced from the same CFBD team-PPA family
 * already used by the production model. One cached request per season window;
 * no market data and no customer-request fanout.
 */

import { readCache, writeCache } from "./cache.js";
import { collegeApiKey } from "./collegeSecrets.js";
import { resolveTeamExact } from "./teams.js";

const TTL_MS = 2 * 60 * 60 * 1000;
const ERR_TTL_MS = 15 * 60 * 1000;
const BASE = "https://api.collegefootballdata.com";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function seasonYear(date = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).format(date);
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 8 ? y : y - 1;
}

function unwrap(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data?.items)) return json.data.items;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.items)) return json.items;
  return [];
}

function pick(obj, paths = []) {
  for (const path of paths) {
    const value = path.split(".").reduce((cur, key) => cur?.[key], obj);
    const n = num(value);
    if (n != null) return n;
  }
  return null;
}

export function parseCfbDeepPpaRow(row = {}) {
  return {
    school: row.team || row.school || null,
    passEpa: pick(row, ["offense.passing", "offense.pass", "offense.passingPpa", "offense.passingEPA", "passingPpa", "passingEPA"]),
    rushEpa: pick(row, ["offense.rushing", "offense.rush", "offense.rushingPpa", "offense.rushingEPA", "rushingPpa", "rushingEPA"]),
    passEpaAllowed: pick(row, ["defense.passing", "defense.pass", "defense.passingPpa", "defense.passingEPA", "passingPpaAllowed", "passingEPAAllowed"]),
    rushEpaAllowed: pick(row, ["defense.rushing", "defense.rush", "defense.rushingPpa", "defense.rushingEPA", "rushingPpaAllowed", "rushingEPAAllowed"]),
    successRate: pick(row, ["offense.successRate", "offense.success", "successRate"]),
    successRateAllowed: pick(row, ["defense.successRate", "defense.success", "successRateAllowed"]),
    explosiveRate: pick(row, ["offense.explosiveness", "offense.explosiveRate", "explosiveness", "explosiveRate"]),
    explosiveRateAllowed: pick(row, ["defense.explosiveness", "defense.explosiveRate", "explosivenessAllowed", "explosiveRateAllowed"]),
  };
}

function indexRows(rows = []) {
  const byEspnId = {};
  const bySchool = {};
  for (const raw of rows) {
    const parsed = parseCfbDeepPpaRow(raw);
    if (!parsed.school) continue;
    const hit = resolveTeamExact("cfb", { name: parsed.school, school: parsed.school });
    const row = {
      ...parsed,
      espnId: hit?.espnId ? String(hit.espnId) : null,
      school: hit?.school || parsed.school,
      source: "cfbd-team-ppa",
    };
    const schoolKey = String(row.school || "").trim().toLowerCase();
    if (schoolKey) bySchool[schoolKey] = row;
    if (row.espnId) byEspnId[row.espnId] = row;
  }
  return { byEspnId, bySchool };
}

export async function loadCfbDeepFeatures(env = {}, { fetchFn = fetch, now = Date.now() } = {}) {
  const season = seasonYear(new Date(now));
  const key = collegeApiKey(env, "cfbd");
  if (!key) return { season, byEspnId: {}, bySchool: {}, meta: { configured: false, records: 0, error: "no-api-key" } };
  const cacheKey = `cfb-deep-ppa-v1-${season}`;
  const cached = await readCache(cacheKey, env.caches, TTL_MS);
  if (cached?.meta) return cached;

  let rows = [];
  let status = 0;
  let error = null;
  for (const path of ["/ppa/teams", "/ppa/teams/season"]) {
    try {
      const qs = new URLSearchParams({ year: String(season), seasonType: "regular" });
      const res = await fetchFn(`${BASE}${path}?${qs}`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
      status = res.status;
      if (!res.ok) {
        error = `CFBD ${res.status} ${path}`;
        if (res.status === 401) break;
        continue;
      }
      rows = unwrap(await res.json());
      if (rows.length) break;
    } catch (err) {
      error = String(err?.message || err);
    }
  }
  const indexed = indexRows(rows);
  const records = Object.keys(indexed.byEspnId).length || Object.keys(indexed.bySchool).length;
  const payload = {
    season,
    ...indexed,
    meta: {
      configured: true,
      records,
      source: "cfbd-team-ppa",
      asOf: new Date(now).toISOString(),
      httpStatus: status,
      error: records ? null : error || "deep-ppa-empty",
      cacheTtlMinutes: TTL_MS / 60000,
      requestBudget: "one cached team-PPA request per two-hour window",
    },
  };
  await writeCache(cacheKey, payload, env.caches, records ? TTL_MS : ERR_TTL_MS);
  return payload;
}

function forTeam(index, team = {}) {
  const id = team.espnId != null ? String(team.espnId) : "";
  if (id && index.byEspnId?.[id]) return index.byEspnId[id];
  const school = String(team.school || team.fullName || team.name || "").trim().toLowerCase();
  return school ? index.bySchool?.[school] || null : null;
}

export function attachCfbDeepFeatures(games = [], feed = {}) {
  return (games || []).map((game) => {
    if (game.sport && game.sport !== "cfb") return game;
    const home = forTeam(feed, game.home) || {};
    const away = forTeam(feed, game.away) || {};
    return {
      ...game,
      cfbDeepInput: {
        ...(game.cfbDeepInput || {}),
        home: { ...(game.cfbDeepInput?.home || {}), ...home },
        away: { ...(game.cfbDeepInput?.away || {}), ...away },
      },
    };
  });
}
