import {fetchWithCfbBackoff} from "./cfbProviderBackoff.js";
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

async function fetchRows(key, path, query, fetchFn, env) {
  try {
    const qs = new URLSearchParams();
    for (const [k,v] of Object.entries(query || {})) if (v != null) qs.set(k, String(v));
    const res = await fetchWithCfbBackoff(`${BASE}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    },env,fetchFn);
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

/**
 * Resolve in-season observation count for prior/current blending.
 * Prefer explicit completed-game counts; fall back to week-bounded CORE
 * through-week as an information-quality proxy (never invent games).
 * Do NOT treat SP `off`/`def` ratings as current PPG.
 */
export function resolvePersistedGamesPlayed(fields = {}) {
  const explicit = num(fields.gamesPlayed) ?? num(fields.games) ?? num(fields.nGames);
  if (explicit != null && explicit > 0) return explicit;
  const throughWeek = num(fields.coreThroughWeek);
  if (fields.coreWeekBounded === true && throughWeek != null && throughWeek > 0) {
    return throughWeek;
  }
  return null;
}

function espnIdFromTeamKey(teamId, fields = {}) {
  if (fields.espnId != null && String(fields.espnId).trim()) return String(fields.espnId);
  const raw = String(teamId || "");
  const m = /^(?:cfb:espn:|cfb-)?(\d{1,12})$/.exec(raw);
  return m ? m[1] : null;
}

// Prefer canonical weekly D1 state over any daytime provider request.
// Research-only fields preserve source units and their as-of timestamps.
async function readPersistedCfbDeep(env,season,now) {
  if(!env.DB?.prepare)return null;
  try {
    const result=await env.DB.prepare(`
      SELECT team_id,features_json,as_of FROM team_feature_snapshots
      WHERE sport='cfb' AND season=? AND feature_version='cfb-features-v1'
        AND as_of<=?
      ORDER BY as_of DESC LIMIT 700
    `).bind(season,new Date(now).toISOString()).all();
    const index={byEspnId:{},bySchool:{}};
    const seen=new Set();
    let maxAsOf=null;
    let withGamesPlayed=0;
    let withOffensePpa=0;
    for(const rec of result?.results||[]){
      if(seen.has(String(rec.team_id)))continue;
      let fields;
      try{fields=JSON.parse(rec.features_json||"{}");}catch{continue;}
      const school=fields.team||fields.school;
      if(!school)continue;
      seen.add(String(rec.team_id));
      const gamesPlayed=resolvePersistedGamesPlayed(fields);
      const espnId=espnIdFromTeamKey(rec.team_id,fields);
      const value={
        offensePpa:num(fields.ppaOff),defensePpa:num(fields.ppaDef),
        passEpa:num(fields.ppaPass),rushEpa:num(fields.ppaRush),
        passEpaAllowed:num(fields.ppaPassAllowed),
        rushEpaAllowed:num(fields.ppaRushAllowed),
        successRate:num(fields.offensiveSuccessRate),
        successRateAllowed:num(fields.defensiveSuccessRate),
        explosiveRate:num(fields.offensiveExplosiveness),
        explosiveRateAllowed:num(fields.defensiveExplosiveness),
        lineYards:num(fields.offensiveLineYards),
        lineYardsAllowed:num(fields.defensiveLineYards),
        havocRate:num(fields.defensiveHavoc),
        havocAllowed:num(fields.offensiveHavoc),
        pointsPerOpportunity:num(fields.offensivePointsPerOpportunity),
        pointsPerOpportunityAllowed:num(fields.defensivePointsPerOpportunity),
        // Explicit PPG only — never coerce SP `off`/`def` ratings into current form.
        currentPointsForPerGame:num(fields.currentPointsForPerGame ?? fields.pfPg ?? fields.pointsForPerGame),
        currentPointsAgainstPerGame:num(fields.currentPointsAgainstPerGame ?? fields.paPg ?? fields.pointsAgainstPerGame),
        gamesPlayed:gamesPlayed??0,
        gamesPlayedSource:gamesPlayed==null?null:(num(fields.gamesPlayed)??num(fields.games)??num(fields.nGames))!=null?"explicit":"coreThroughWeek",
        // Snapshot collection time is not the CORE calculation window. The
        // model must independently verify source week AND collection time.
        core:fields.coreWeekBounded===true?num(fields.core):null,
        coreOffense:fields.coreWeekBounded===true?num(fields.coreOffense):null,
        coreDefense:fields.coreWeekBounded===true?num(fields.coreDefense):null,
        coreYear:num(fields.coreYear),
        coreThroughWeek:num(fields.coreThroughWeek),
        coreThroughSeasonType:fields.coreThroughSeasonType??null,
        coreSourceEndpoint:fields.coreSourceEndpoint??null,
        coreSourceAsOf:rec.as_of,
        snapshotAsOf:rec.as_of,
        coreWeekBounded:fields.coreWeekBounded===true,
        talent:num(fields.talent),
        returningPpa:num(fields.returningPpa),
        teamId:String(rec.team_id),
        espnId,
      };
      if(gamesPlayed!=null&&gamesPlayed>0)withGamesPlayed+=1;
      if(value.offensePpa!=null)withOffensePpa+=1;
      put(index,school,value);
      if(espnId&&!index.byEspnId[espnId])index.byEspnId[espnId]=index.bySchool[String(school).toLowerCase()]||value;
      if(!maxAsOf||String(rec.as_of)>maxAsOf)maxAsOf=String(rec.as_of);
    }
    const records=Object.keys(index.bySchool).length;
    if(!records)return null;
    return {season,...index,meta:{configured:true,records,
      source:"cfbd-weekly-persisted-d1",asOf:maxAsOf,cacheOnly:true,
      networkCalls:0,modelAuthority:false,wagerAuthority:false,
      withGamesPlayed,withOffensePpa,
      priorDecay:"n/(n+6) via blendPriorCurrent; n from gamesPlayed or coreThroughWeek"}};
  }catch{return null;}
}

async function readWarmedCfbDeepCache(env, season) {
  const cacheKey = `cfb-deep-v2-${season}`;
  const cached = await readCache(cacheKey, env.caches, TTL_MS);
  if (!cached) return null;
  const records = Object.keys(cached.byEspnId || {}).length || Object.keys(cached.bySchool || {}).length;
  if (!records && !cached.meta) return null;
  return {
    season: cached.season ?? season,
    byEspnId: cached.byEspnId || {},
    bySchool: cached.bySchool || {},
    meta: {
      ...(cached.meta || {}),
      configured: true,
      records: cached.meta?.records ?? records,
      cacheOnly: true,
      networkCalls: 0,
      source: cached.meta?.source || "cfbd-warmed-cache",
      warmedCacheFallback: true,
    },
  };
}

export async function loadCfbDeepFeatures(env = {}, { fetchFn = fetch, now = Date.now() } = {}) {
  const season = seasonYear(new Date(now));
  // A persisted, quota-free current-season snapshot does not require a provider API key.
  // Prefer verified D1 state; if D1 misses, fall back to a warmed Workers cache
  // from the morning harvest — never invent empty features when either source has data.
  const cacheOnly = env.cfbdCacheOnly || (env.DB?.prepare && env.cfbdNetworkAuthorized !== true);
  if (cacheOnly) {
    const persisted = await readPersistedCfbDeep(env, season, now);
    if (persisted) return persisted;
    const warmed = await readWarmedCfbDeepCache(env, season);
    if (warmed) return warmed;
    return {
      season, byEspnId: {}, bySchool: {},
      meta: { configured: true, records: 0, cacheOnly: true, error: "persisted-feature-miss", networkCalls:0 },
    };
  }

  const key = collegeApiKey(env, "cfbd");
  if (!key) {
    // No provider key: still serve D1 / warmed cache rather than silently empty.
    const persisted = await readPersistedCfbDeep(env, season, now);
    if (persisted) return persisted;
    const warmed = await readWarmedCfbDeepCache(env, season);
    if (warmed) return { ...warmed, meta: { ...warmed.meta, error: warmed.meta?.error || null, configured: true } };
    return { season, byEspnId: {}, bySchool: {}, meta: { configured: false, records: 0, error: "no-api-key" } };
  }
  const cacheKey = `cfb-deep-v2-${season}`;
  // Prefer fresher D1 weekly snapshots over a stale in-memory cache when both exist.
  const persistedFirst = await readPersistedCfbDeep(env, season, now);
  if (persistedFirst?.meta?.withOffensePpa > 0) return persistedFirst;
  const cached = await readCache(cacheKey, env.caches, TTL_MS);
  if (cached?.meta) return cached;
  if (persistedFirst) return persistedFirst;
  const [ppaPrimary, adv, games] = await Promise.all([
    fetchRows(key, "/ppa/teams", { year: season, seasonType: "regular" }, fetchFn, env),
    fetchRows(key, "/stats/season/advanced", { year: season, seasonType: "regular" }, fetchFn, env),
    fetchRows(key, "/games", { year: season, seasonType: "regular" }, fetchFn, env),
  ]);

  let ppa = ppaPrimary;
  if (!ppa.ok || !ppa.rows.length) {
    ppa = await fetchRows(key, "/ppa/teams/season", { year: season }, fetchFn, env);
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
