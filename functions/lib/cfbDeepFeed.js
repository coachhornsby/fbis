/**
 * CFBD deep CFB feature feed for CFB-FBIS-v2.
 * Market-blind. Cached. Uses current-season team PPA + advanced team stats +
 * completed games to provide live form and matchup features.
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

function teamName(row = {}) {
  return row.team || row.school || row.homeTeam || row.awayTeam || null;
}

function canonicalTeam(name) {
  const raw = String(name || "").trim();
  if (!raw) return null;
  const hit = resolveTeamExact("cfb", { name: raw, school: raw });
  return {
    school: hit?.school || raw,
    espnId: hit?.espnId ? String(hit.espnId) : null,
    abbr: hit?.abbr || null,
  };
}

export function parseCfbDeepPpaRow(row = {}) {
  return {
    school: row.team || row.school || null,
    offensePpa: pick(row, ["offense.overall", "offense.total", "offense.ppa", "offensePpa", "offense"]),
    defensePpa: pick(row, ["defense.overall", "defense.total", "defense.ppa", "defensePpa", "defense"]),
    passEpa: pick(row, ["offense.passing", "offense.pass", "offense.passingPpa", "offense.passingEPA", "passingPpa", "passingEPA"]),
    rushEpa: pick(row, ["offense.rushing", "offense.rush", "offense.rushingPpa", "offense.rushingEPA", "rushingPpa", "rushingEPA"]),
    passEpaAllowed: pick(row, ["defense.passing", "defense.pass", "defense.passingPpa", "defense.passingEPA", "passingPpaAllowed", "passingEPAAllowed"]),
    rushEpaAllowed: pick(row, ["defense.rushing", "defense.rush", "defense.rushingPpa", "defense.rushingEPA", "rushingPpaAllowed", "rushingEPAAllowed"]),
    // Some CFBD team-PPA payloads include these dimensions directly. Preserve
    // them here; the advanced endpoint can overwrite/extend them when available.
    successRate: pick(row, ["offense.successRate", "offense.success", "successRate"]),
    successRateAllowed: pick(row, ["defense.successRate", "defense.success", "successRateAllowed"]),
    explosiveRate: pick(row, ["offense.explosiveness", "offense.explosiveRate", "explosiveness", "explosiveRate"]),
    explosiveRateAllowed: pick(row, ["defense.explosiveness", "defense.explosiveRate", "explosivenessAllowed", "explosiveRateAllowed"]),
  };
}

export function parseCfbAdvancedRow(row = {}) {
  return {
    school: row.team || row.school || null,
    successRate: pick(row, ["offense.successRate", "offense.success", "successRate"]),
    successRateAllowed: pick(row, ["defense.successRate", "defense.success", "successRateAllowed"]),
    explosiveRate: pick(row, ["offense.explosiveness", "offense.explosiveRate", "explosiveness", "explosiveRate"]),
    explosiveRateAllowed: pick(row, ["defense.explosiveness", "defense.explosiveRate", "explosivenessAllowed", "explosiveRateAllowed"]),
    havocRate: pick(row, ["defense.havoc.total", "defense.havoc", "havoc.total", "havocRate"]),
    havocAllowed: pick(row, ["offense.havoc.total", "offense.havoc", "havocAllowed"]),
    lineYards: pick(row, ["offense.lineYards", "offense.lineYardsAverage", "lineYards"]),
    lineYardsAllowed: pick(row, ["defense.lineYards", "defense.lineYardsAverage", "lineYardsAllowed"]),
    stuffRate: pick(row, ["defense.stuffRate", "stuffRate"]),
    pointsPerOpportunity: pick(row, ["offense.pointsPerOpportunity", "pointsPerOpportunity"]),
    pointsPerOpportunityAllowed: pick(row, ["defense.pointsPerOpportunity", "pointsPerOpportunityAllowed"]),
    pacePlays: pick(row, ["offense.plays", "plays", "pace.plays"]),
  };
}

async function fetchRows(key, path, query, fetchFn) {
  try {
    const qs = new URLSearchParams();
    for (const [k,v] of Object.entries(query || {})) if (v != null) qs.set(k, String(v));
    const res = await fetchFn(`${BASE}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    const status = res.status;
    if (!res.ok) return { ok: false, status, rows: [], path, error: `CFBD ${status} ${path}` };
    return { ok: true, status, rows: unwrap(await res.json()), path, error: null };
  } catch (err) {
    return { ok: false, status: 0, rows: [], path, error: String(err?.message || err) };
  }
}

function put(index, name, patch = {}) {
  const hit = canonicalTeam(name);
  if (!hit) return;
  const key = String(hit.school).toLowerCase();
  const current = index.bySchool[key] || { school: hit.school, espnId: hit.espnId, abbr: hit.abbr };
  const row = { ...current, ...patch, school: hit.school, espnId: hit.espnId || current.espnId || null, abbr: hit.abbr || current.abbr || null };
  index.bySchool[key] = row;
  if (row.espnId) index.byEspnId[String(row.espnId)] = row;
}

function buildCompletedForm(rows = [], now = Date.now()) {
  const bySchool = new Map();
  const add = (name, pf, pa, start) => {
    const hit = canonicalTeam(name);
    const pFor = num(pf), pAgainst = num(pa);
    if (!hit || pFor == null || pAgainst == null) return;
    const ts = Date.parse(String(start || ""));
    if (Number.isFinite(ts) && ts >= now) return;
    const key = String(hit.school).toLowerCase();
    const cur = bySchool.get(key) || { school: hit.school, gamesPlayed: 0, pointsFor: 0, pointsAgainst: 0 };
    cur.gamesPlayed += 1;
    cur.pointsFor += pFor;
    cur.pointsAgainst += pAgainst;
    bySchool.set(key, cur);
  };
  for (const g of rows) {
    const hp = g.homePoints ?? g.homeScore ?? g.home_points;
    const ap = g.awayPoints ?? g.awayScore ?? g.away_points;
    const status = String(g.status || g.gameStatus || "").toLowerCase();
    const completed = g.completed === true || g.isCompleted === true || ["final","complete","completed"].includes(status) || (num(hp) != null && num(ap) != null);
    if (!completed) continue;
    const start = g.startDate || g.start_date || g.startTime || g.kickoff || null;
    add(g.homeTeam || g.home || g.home_team, hp, ap, start);
    add(g.awayTeam || g.away || g.away_team, ap, hp, start);
  }
  return bySchool;
}

export async function loadCfbDeepFeatures(env = {}, { fetchFn = fetch, now = Date.now() } = {}) {
  const season = seasonYear(new Date(now));
  const key = collegeApiKey(env, "cfbd");
  if (!key) return { season, byEspnId: {}, bySchool: {}, meta: { configured: false, records: 0, error: "no-api-key" } };
  const cacheKey = `cfb-deep-v2-${season}`;
  const cached = await readCache(cacheKey, env.caches, TTL_MS);
  if (cached?.meta) return cached;

  const [ppaPrimary, adv, games] = await Promise.all([
    fetchRows(key, "/ppa/teams", { year: season, seasonType: "regular" }, fetchFn),
    fetchRows(key, "/stats/season/advanced", { year: season, seasonType: "regular" }, fetchFn),
    fetchRows(key, "/games", { year: season, seasonType: "regular" }, fetchFn),
  ]);

  let ppa = ppaPrimary;
  if (!ppa.ok || !ppa.rows.length) {
    ppa = await fetchRows(key, "/ppa/teams/season", { year: season }, fetchFn);
  }

  const index = { byEspnId: {}, bySchool: {} };
  for (const raw of ppa.rows || []) {
    const parsed = parseCfbDeepPpaRow(raw);
    if (!parsed.school) continue;
    put(index, parsed.school, { ...parsed, sourcePpa: ppa.path });
  }
  for (const raw of adv.rows || []) {
    const parsed = parseCfbAdvancedRow(raw);
    if (!parsed.school) continue;
    put(index, parsed.school, { ...parsed, sourceAdvanced: adv.path });
  }

  const form = buildCompletedForm(games.rows || [], now);
  for (const rec of form.values()) {
    const g = Math.max(0, Number(rec.gamesPlayed) || 0);
    put(index, rec.school, {
      gamesPlayed: g,
      currentPointsForPerGame: g ? rec.pointsFor / g : null,
      currentPointsAgainstPerGame: g ? rec.pointsAgainst / g : null,
      // Keep raw scoring form for diagnostics/LLM context only. The fitted
      // projection base uses PPA-derived current strength, matching training.
      sourceForm: "cfbd:/games",
    });
  }

  // /stats/season/advanced offense.plays is cumulative. Convert it to
  // the same per-game pace normalization used by historical rolling features.
  for (const row of Object.values(index.bySchool)) {
    const gamesPlayed = Math.max(0, Number(row.gamesPlayed) || 0);
    const cumulativePlays = num(row.pacePlays);
    if (!gamesPlayed || cumulativePlays == null) continue;
    const playsPerGame = cumulativePlays / gamesPlayed;
    put(index, row.school, {
      pacePlaysPerGame: playsPerGame,
      paceNorm: (playsPerGame - 70) / 15,
      sourcePace: "cfbd:/stats/season/advanced",
    });
  }

  const records = Object.keys(index.byEspnId).length || Object.keys(index.bySchool).length;
  const report = [ppa, adv, games].map(r => ({ path:r.path, ok:r.ok, status:r.status, n:r.rows?.length||0, error:r.error||null }));
  const payload = {
    season,
    ...index,
    meta: {
      configured: true,
      records,
      source: "cfbd-team-ppa+advanced+completed-games",
      asOf: new Date(now).toISOString(),
      httpStatus: report.every(r=>r.ok) ? 200 : (report.find(r=>!r.ok)?.status || 0),
      error: records ? null : report.map(r=>r.error).filter(Boolean).join("; ") || "cfb-deep-empty",
      cacheTtlMinutes: TTL_MS / 60000,
      requestBudget: "three cached CFBD requests per two-hour window",
      endpoints: report,
      completedFormTeams: form.size,
      marketInformed: false,
    },
  };
  await writeCache(cacheKey, payload, env.caches, records ? TTL_MS : ERR_TTL_MS);
  return payload;
}

function forTeam(index, team = {}) {
  const id = team.espnId != null ? String(team.espnId) : "";
  if (id && index.byEspnId?.[id]) return index.byEspnId[id];
  const school = String(team.school || team.fullName || team.name || "").trim().toLowerCase();
  if (school && index.bySchool?.[school]) return index.bySchool[school];
  const hit = resolveTeamExact("cfb", team);
  const resolved = String(hit?.school || "").toLowerCase();
  return resolved ? index.bySchool?.[resolved] || null : null;
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
