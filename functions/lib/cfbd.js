/**
 * CollegeFootballData (and optional CollegeBasketballData) client.
 * Authorized CFB team-specific prior source. Never logs the API key.
 */

import { readCache, writeCache } from "./cache.js";
import { resolveTeamExact } from "./teams.js";
import { CFB_PRIOR_VERSION, CFB_PRIOR_VERSION_CFBD, priorForTeam } from "./cfbPrior.js";
import PRIOR from "../../data/cfb/prior-v1.js";
import { collegeApiKey, cfbdConfigured as secretsConfigured } from "./collegeSecrets.js";

export const CFBD_BASE = "https://api.collegefootballdata.com";
export const CBBD_BASE = "https://api.collegebasketballdata.com";
export const CFBD_LEAGUE_PPG = 26.5;
export const CFBD_ELO_CENTER = 1500;
export const CFBD_ELO_PER_POINT = 25;
const PRIOR_TTL_MS = 6 * 60 * 60 * 1000;
const ERR_TTL_MS = 15 * 60 * 1000;
const FEATURE_TTL_MS = 2 * 60 * 60 * 1000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function cfbdConfigured(env = {}) {
  return secretsConfigured(env);
}

/** CFBD returns a bare array, `{ data: [] }`, or `{ data: { items } }`. */
export function unwrapCfbdResponse(json) {
  if (json == null) return { data: null, meta: null };
  if (Array.isArray(json)) return { data: json, meta: null };
  if (Array.isArray(json.data?.items)) return { data: json.data.items, meta: json.meta || null };
  if (Array.isArray(json.data)) return { data: json.data, meta: json.meta || null };
  if (Array.isArray(json.items)) return { data: json.items, meta: json.meta || null };
  if (json && typeof json === "object" && (json.message || json.error) && !json.team && !json.year) {
    return { data: null, meta: json.meta || null, error: json.message || json.error };
  }
  return { data: json, meta: json.meta || null };
}

export function cfbdPublicMeta(meta = {}) {
  return {
    configured: Boolean(meta.configured),
    records: Number(meta.records) || 0,
    asOf: meta.asOf || null,
    year: meta.year || null,
    version: meta.version || null,
    source: meta.source || null,
    fallback: Boolean(meta.fallback),
    httpStatus: meta.httpStatus == null ? null : Number(meta.httpStatus),
    endpoints: Array.isArray(meta.endpoints) ? meta.endpoints : [],
    unmatched: Number(meta.unmatched) || 0,
    fbs: Number(meta.fbs) || 0,
    fcs: Number(meta.fcs) || 0,
    provisional: Number(meta.provisional) || 0,
    error: meta.error ? String(meta.error) : null,
    limitation: meta.limitation || null,
  };
}

function queryString(query = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function cfbdRequest(base, path, env, { query, fetchFn = fetch } = {}) {
  const source = base === CBBD_BASE ? "cbbd" : "cfbd";
  if (!collegeApiKey(env, source)) {
    return { ok: false, status: 0, reason: "no-api-key", data: null, n: 0 };
  }
  const url = `${base}${path}${queryString(query)}`;
  try {
    const res = await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${collegeApiKey(env, source)}`,
        Accept: "application/json",
      },
    });
    const status = res.status;
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const unwrapped = unwrapCfbdResponse(json);
    const list = Array.isArray(unwrapped.data) ? unwrapped.data : unwrapped.data == null ? [] : null;
    const n = Array.isArray(list) ? list.length : unwrapped.data ? 1 : 0;
    if (!res.ok) {
      return {
        ok: false,
        status,
        reason: `CFBD ${status} ${path}`,
        data: null,
        n: 0,
        path,
      };
    }
    return { ok: true, status, data: Array.isArray(list) ? list : unwrapped.data, n, path };
  } catch (err) {
    return { ok: false, status: 0, reason: String(err?.message || err), data: null, n: 0, path };
  }
}

export function eloToPower(elo) {
  const v = num(elo);
  if (v == null) return null;
  return round2((v - CFBD_ELO_CENTER) / CFBD_ELO_PER_POINT);
}

/** CFBD SP+ defense.rating is expected points allowed (lower is better) when rank-1 is low. */
export function spDefenseIsPointsAllowed(spRows = []) {
  const rows = (spRows || []).filter((r) => num(r?.defense?.ranking) != null && num(r?.defense?.rating) != null);
  if (rows.length < 6) return true;
  const top = rows.filter((r) => num(r.defense.ranking) <= 15);
  const bottom = rows.filter((r) => num(r.defense.ranking) >= Math.max(80, rows.length - 20));
  const avg = (list) => list.reduce((s, r) => s + num(r.defense.rating), 0) / (list.length || 1);
  if (!top.length || !bottom.length) return true;
  return avg(top) < avg(bottom);
}

function indexByTeam(rows, nameKeys = ["team", "school"]) {
  const map = new Map();
  for (const row of rows || []) {
    for (const key of nameKeys) {
      const name = String(row?.[key] || "").trim().toLowerCase();
      if (name) map.set(name, row);
    }
  }
  return map;
}

function resolveCfbdTeam(row) {
  const name = row?.team || row?.school || "";
  const abbr = row?.abbreviation || row?.abbr || "";
  return (
    resolveTeamExact("cfb", { name }) ||
    resolveTeamExact("cfb", { school: name }) ||
    (abbr ? resolveTeamExact("cfb", { abbr }) : null)
  );
}

function classifyRow(name, teamsByName, srsRow, hasFbsRating) {
  const team = teamsByName.get(String(name || "").trim().toLowerCase());
  const raw = team?.classification || srsRow?.classification || (hasFbsRating ? "fbs" : null);
  if (!raw) return null;
  const up = String(raw).toUpperCase();
  if (up === "FBS") return "FBS";
  if (up === "FCS") return "FCS";
  return up;
}

function pickPower({ spRating, fpi, srs, elo }) {
  if (spRating != null) return { power: spRating, powerSource: "sp" };
  if (fpi != null) return { power: fpi, powerSource: "fpi" };
  if (srs != null) return { power: srs, powerSource: "srs" };
  if (elo != null) return { power: eloToPower(elo), powerSource: "elo" };
  return { power: null, powerSource: null };
}

function offDefFrom({ spOff, spDef, power, defenseIsPa }) {
  if (spOff != null && spDef != null) {
    const def = defenseIsPa ? spDef : round2(2 * CFBD_LEAGUE_PPG - spDef);
    return { off: round2(spOff), def };
  }
  if (power == null) return { off: null, def: null };
  return {
    off: round2(CFBD_LEAGUE_PPG + power * 0.45),
    def: round2(CFBD_LEAGUE_PPG - power * 0.45),
  };
}

export function buildCfbdCatalog({
  sp = [],
  fpi = [],
  srs = [],
  elo = [],
  talent = [],
  returning = [],
  teams = [],
  prevFbs = [],
  year = null,
  asOf = null,
} = {}) {
  const spBy = indexByTeam(sp);
  const fpiBy = indexByTeam(fpi);
  const srsBy = indexByTeam(srs);
  const eloBy = indexByTeam(elo);
  const talentBy = indexByTeam(talent, ["school", "team"]);
  const retBy = indexByTeam(returning);
  const teamsByName = indexByTeam(teams, ["school", "team"]);
  const prev = new Set((prevFbs || []).map((n) => String(n).trim().toLowerCase()));
  const defenseIsPa = spDefenseIsPointsAllowed(sp);
  const names = new Set();
  for (const map of [spBy, fpiBy, srsBy, eloBy]) {
    for (const k of map.keys()) names.add(k);
  }

  const byEspnId = {};
  const bySchool = {};
  let unmatched = 0;
  let fbs = 0;
  let fcs = 0;
  let provisionalN = 0;

  for (const key of names) {
    const spRow = spBy.get(key);
    const fpiRow = fpiBy.get(key);
    const srsRow = srsBy.get(key);
    const eloRow = eloBy.get(key);
    const teamRow = teamsByName.get(key);
    const raw = spRow || fpiRow || srsRow || eloRow || teamRow;
    if (!raw) continue;
    const hit = resolveCfbdTeam(raw);
    const name = raw?.team || raw?.school || hit?.school || key;
    const spRating = num(spRow?.rating);
    const spOff = num(spRow?.offense?.rating);
    const spDef = num(spRow?.defense?.rating);
    const fpiVal = num(fpiRow?.fpi);
    const srsVal = num(srsRow?.rating);
    const eloVal = num(eloRow?.elo);
    const hasFbsRating = spRating != null || fpiVal != null;
    const classification = classifyRow(name, teamsByName, srsRow, hasFbsRating) || hit?.classification || null;
    const newlyPromoted = classification === "FBS" && prev.size > 0 && !prev.has(String(name).trim().toLowerCase()) && !prev.has(String(hit?.school || "").trim().toLowerCase());
    const { power, powerSource } = pickPower({ spRating, fpi: fpiVal, srs: srsVal, elo: eloVal });
    const { off, def } = offDefFrom({ spOff, spDef, power, defenseIsPa });
    const talentVal = num(talentBy.get(key)?.talent);
    const returningPct = num(retBy.get(key)?.percentPPA ?? retBy.get(key)?.usage);
    const sources = [];
    if (spRating != null || spOff != null) sources.push("sp");
    if (fpiVal != null) sources.push("fpi");
    if (srsVal != null) sources.push("srs");
    if (eloVal != null) sources.push("elo");
    if (talentVal != null) sources.push("talent");
    if (returningPct != null) sources.push("returning");
    if (off == null || def == null) {
      if (!hit) unmatched += 1;
      continue;
    }
    const provisional = classification !== "FBS" || newlyPromoted;
    const espnId = hit?.espnId != null ? String(hit.espnId) : null;
    const row = {
      espnId,
      abbr: hit?.abbr || raw?.abbreviation || null,
      school: hit?.school || name,
      n: 0,
      fpi: fpiVal,
      srs: srsVal,
      sp: spRating,
      elo: eloVal,
      talent: talentVal,
      returningPct,
      off,
      def,
      power,
      powerSource,
      conference: raw?.conference || hit?.conference || null,
      classification: classification || (hasFbsRating ? "FBS" : null),
      provisional,
      newlyPromoted: Boolean(newlyPromoted),
      source: sources.length ? `cfbd:${sources.join("+")}` : "cfbd",
      version: CFB_PRIOR_VERSION_CFBD,
      asOf,
      year,
    };
    if (off == null || def == null) continue;
    if (espnId) byEspnId[espnId] = row;
    else unmatched += 1;
    const schoolKey = String(row.school || "").trim().toLowerCase();
    if (schoolKey) bySchool[schoolKey] = row;
  }

  for (const row of Object.values(byEspnId)) {
    if (row.classification === "FBS") fbs += 1;
    if (row.classification === "FCS") fcs += 1;
    if (row.provisional) provisionalN += 1;
  }

  return {
    version: CFB_PRIOR_VERSION_CFBD,
    year,
    asOf,
    byEspnId,
    bySchool,
    nTeams: Object.keys(byEspnId).length,
    fbs,
    fcs,
    provisional: provisionalN,
    unmatched,
    defenseIsPa,
  };
}

export function mergePriorCatalog(cfbdCatalog, fallback = PRIOR) {
  const byEspnId = {};
  for (const [id, row] of Object.entries(fallback.byEspnId || {})) {
    byEspnId[id] = { ...row, version: row.version || CFB_PRIOR_VERSION, asOf: row.asOf || fallback.builtAt || null };
  }
  for (const [id, row] of Object.entries(cfbdCatalog?.byEspnId || {})) {
    byEspnId[id] = row;
  }
  const bySchool = { ...(cfbdCatalog?.bySchool || {}) };
  return {
    version: cfbdCatalog?.nTeams ? CFB_PRIOR_VERSION_CFBD : fallback.version || CFB_PRIOR_VERSION,
    year: cfbdCatalog?.year || fallback.season || null,
    asOf: cfbdCatalog?.asOf || fallback.builtAt || null,
    byEspnId,
    bySchool,
    nTeams: Object.keys(byEspnId).length,
    cfbdTeams: cfbdCatalog?.nTeams || 0,
    fbs: cfbdCatalog?.fbs || 0,
    fcs: cfbdCatalog?.fcs || 0,
    provisional: cfbdCatalog?.provisional || 0,
    unmatched: cfbdCatalog?.unmatched || 0,
  };
}

function emptyFallbackMeta(extra = {}) {
  return cfbdPublicMeta({
    configured: false,
    records: 0,
    asOf: null,
    year: PRIOR.season || null,
    version: CFB_PRIOR_VERSION,
    source: PRIOR.source,
    fallback: true,
    ...extra,
  });
}

function cfbSeasonYear(date = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 8 ? y : y - 1;
}

function rowTeamHint(row = {}) {
  return (
    row.team ||
    row.school ||
    row.program ||
    row.destination ||
    row.destinationTeam ||
    row.toTeam ||
    row.newSchool ||
    row.college ||
    row.teamName ||
    null
  );
}

function resolveFeatureTeam(row = {}) {
  const hint = rowTeamHint(row);
  const abbr = row.abbreviation || row.abbr || row.teamAbbreviation || null;
  return (
    resolveTeamExact("cfb", { name: hint }) ||
    resolveTeamExact("cfb", { school: hint }) ||
    (abbr ? resolveTeamExact("cfb", { abbr }) : null)
  );
}

function ensureFeatureRow(buckets, row = {}) {
  const key = row.espnId ? `id:${row.espnId}` : row.school ? `school:${String(row.school).trim().toLowerCase()}` : null;
  if (!key) return null;
  if (!buckets[key]) buckets[key] = { ...row };
  return buckets[key];
}

function parseEpaFromRow(row = {}) {
  const off = num(
    row.offense?.overall ??
      row.offense?.total ??
      row.offense?.ppa ??
      row.offensive?.overall ??
      row.offensivePpa ??
      row.offensiveEPA ??
      row.offenseEpa
  );
  const def = num(
    row.defense?.overall ??
      row.defense?.total ??
      row.defense?.ppa ??
      row.defensive?.overall ??
      row.defensivePpa ??
      row.defensiveEPA ??
      row.defenseEpa
  );
  const net = num(row.net ?? row.overall ?? (off != null && def != null ? off - def : null));
  return { off, def, net };
}

function trimFeatureOutput(buckets = {}) {
  const byEspnId = {};
  const bySchool = {};
  for (const row of Object.values(buckets)) {
    if (row.espnId) byEspnId[String(row.espnId)] = row;
    if (row.school) bySchool[String(row.school).trim().toLowerCase()] = row;
  }
  return { byEspnId, bySchool };
}

async function firstSuccessfulCfbdRequest(env, attempts, fetchFn) {
  const report = [];
  for (const [path, query] of attempts) {
    const res = await cfbdRequest(CFBD_BASE, path, env, { query, fetchFn });
    report.push({ path, status: res.status, n: res.n || 0, ok: res.ok });
    if (res.ok && Array.isArray(res.data) && res.data.length) {
      return { rows: res.data, report, chosenPath: path };
    }
    if (res.status === 401) break;
  }
  return { rows: [], report, chosenPath: null };
}

function personKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function buildTransferQbHistory(transfers = [], playerStats = [], priorSeason = null) {
  const stats = new Map();
  for (const row of playerStats || []) {
    const name = row.player || row.athlete || row.playerName || row.name;
    const key = personKey(name);
    if (!key) continue;
    if (!stats.has(key)) stats.set(key, { player: name, team: row.team || null, season: priorSeason, attempts: 0, yards: 0, touchdowns: 0, interceptions: 0 });
    const out = stats.get(key);
    const type = String(row.statType || row.type || row.category || "").toLowerCase().replace(/[^a-z]/g, "");
    const value = num(row.statValue ?? row.value ?? row.total ?? row.amount ?? row.stat);
    if (value == null) continue;
    if (/pass.*attempt|attempt.*pass/.test(type)) out.attempts += value;
    else if (/pass.*yard/.test(type)) out.yards += value;
    else if (/pass.*touchdown|passingtd/.test(type)) out.touchdowns += value;
    else if (/interception/.test(type)) out.interceptions += value;
  }
  const byDestination = new Map();
  for (const row of transfers || []) {
    const pos = String(row.position || row.pos || row.positionGroup || "").toUpperCase();
    const destination = row.destination || row.destinationTeam || row.newSchool || row.toTeam;
    const name = row.player || row.playerName || row.name || [row.firstName, row.lastName].filter(Boolean).join(" ");
    if (!(pos === "QB" || /QUARTERBACK/.test(pos)) || !destination || !name) continue;
    const history = stats.get(personKey(name)) || null;
    const record = {
      player: name,
      origin: row.origin || row.originTeam || row.fromTeam || row.oldSchool || history?.team || null,
      destination,
      priorSeason,
      prior: history,
      historyAvailable: Boolean(history && (history.attempts || history.yards || history.touchdowns || history.interceptions)),
    };
    const key = String(destination).trim().toLowerCase();
    if (!byDestination.has(key)) byDestination.set(key, []);
    byDestination.get(key).push(record);
  }
  return byDestination;
}

export function buildCfbFeatureCatalog({ epa = [], returning = [], transfers = [], playerStats = [], coaches = [], year = null, asOf = null } = {}) {
  const buckets = {};
  const transferQbHistory = buildTransferQbHistory(transfers, playerStats, year == null ? null : Number(year) - 1);
  for (const row of epa || []) {
    const hit = resolveFeatureTeam(row);
    if (!hit) continue;
    const parsed = parseEpaFromRow(row);
    if (parsed.off == null && parsed.def == null && parsed.net == null) continue;
    const out = ensureFeatureRow(buckets, {
      espnId: hit.espnId ? String(hit.espnId) : null,
      school: hit.school || rowTeamHint(row),
      epaOff: parsed.off,
      epaDef: parsed.def,
      epaNet: parsed.net,
      epaSource: "cfbd",
      asOf,
      year,
    });
    if (!out) continue;
    if (parsed.off != null) out.epaOff = parsed.off;
    if (parsed.def != null) out.epaDef = parsed.def;
    if (parsed.net != null) out.epaNet = parsed.net;
  }
  for (const row of returning || []) {
    const hit = resolveFeatureTeam(row);
    if (!hit) continue;
    const pct = num(row.percentPPA ?? row.usage ?? row.returningProduction ?? row.returningPct);
    if (pct == null) continue;
    const out = ensureFeatureRow(buckets, {
      espnId: hit.espnId ? String(hit.espnId) : null,
      school: hit.school || rowTeamHint(row),
      returningPct: pct,
      asOf,
      year,
    });
    if (!out) continue;
    out.returningPct = pct;
  }
  for (const row of transfers || []) {
    const hit = resolveFeatureTeam(row);
    if (!hit) continue;
    const out = ensureFeatureRow(buckets, {
      espnId: hit.espnId ? String(hit.espnId) : null,
      school: hit.school || rowTeamHint(row),
      transferIn: 0,
      transferOut: 0,
      qbTransferIn: 0,
      qbTransferOut: 0,
      transferStarsIn: 0,
      transferStarsOut: 0,
      asOf,
      year,
    });
    if (!out) continue;
    const direction = String(row.direction || row.type || row.movement || "").toLowerCase();
    const incoming =
      /\b(in|incoming|arrive|arriving|destination|commit|committed)\b/.test(direction) ||
      Boolean(row.destination || row.destinationTeam || row.newSchool || row.toTeam);
    const pos = String(row.position || row.pos || row.positionGroup || "").toUpperCase();
    const isQb = pos === "QB" || /QUARTERBACK/.test(pos);
    const stars = num(row.stars ?? row.rating ?? row.transferRating ?? row.impactRating);
    if (incoming) {
      out.transferIn = (out.transferIn || 0) + 1;
      if (isQb) out.qbTransferIn = (out.qbTransferIn || 0) + 1;
      if (stars != null) out.transferStarsIn = (out.transferStarsIn || 0) + stars;
    } else {
      out.transferOut = (out.transferOut || 0) + 1;
      if (isQb) out.qbTransferOut = (out.qbTransferOut || 0) + 1;
      if (stars != null) out.transferStarsOut = (out.transferStarsOut || 0) + stars;
    }
  }
  for (const row of coaches || []) {
    const hit = resolveFeatureTeam(row);
    if (!hit) continue;
    const out = ensureFeatureRow(buckets, {
      espnId: hit.espnId ? String(hit.espnId) : null,
      school: hit.school || rowTeamHint(row),
      asOf,
      year,
    });
    if (!out) continue;
    const firstYear = num(row.firstYear ?? row.startYear ?? row.hireYear ?? row.season);
    const tenure = num(row.years ?? row.yearsAtSchool ?? row.tenure);
    const coachName = row.firstName && row.lastName ? `${row.firstName} ${row.lastName}` : row.coach || row.name || null;
    out.coachName = coachName || out.coachName || null;
    out.coachFirstYear = firstYear ?? out.coachFirstYear ?? null;
    out.coachTenure = tenure ?? (firstYear != null && year != null ? Math.max(0, Number(year) - Number(firstYear)) : out.coachTenure ?? null);
    if (firstYear != null && year != null) out.newCoach = Number(firstYear) >= Number(year);
    else if (typeof out.newCoach !== "boolean") out.newCoach = false;
  }
  const finalRows = Object.values(buckets).map((row) => {
    const transferIn = Number(row.transferIn || 0);
    const transferOut = Number(row.transferOut || 0);
    const qbIn = Number(row.qbTransferIn || 0);
    const qbOut = Number(row.qbTransferOut || 0);
    const starsIn = Number(row.transferStarsIn || 0);
    const starsOut = Number(row.transferStarsOut || 0);
    const transferQbs = transferQbHistory.get(String(row.school || "").trim().toLowerCase()) || [];
    return {
      ...row,
      transferNet: transferIn - transferOut,
      qbTransferNet: qbIn - qbOut,
      transferStarDelta: starsIn - starsOut,
      transferQbs,
      transferQbHistoryN: transferQbs.filter((q) => q.historyAvailable).length,
    };
  });
  return trimFeatureOutput(Object.fromEntries(finalRows.map((r) => [r.espnId ? `id:${r.espnId}` : `school:${String(r.school).toLowerCase()}`, r])));
}

export async function loadCfbFeatureFeeds(env = {}, { fetchFn = fetch, now = Date.now() } = {}) {
  const asOf = new Date(now).toISOString();
  const season = cfbSeasonYear(new Date(now));
  const emptyCatalog = { byEspnId: {}, bySchool: {} };
  if (!cfbdConfigured(env)) {
    return {
      season,
      asOf,
      catalog: emptyCatalog,
      meta: cfbdPublicMeta({
        configured: false,
        records: 0,
        fallback: true,
        year: season,
        asOf,
        source: "cfbd-features",
        error: "no-api-key",
      }),
    };
  }
  const cacheKey = `cfb-feature-feeds-v1-${season}`;
  const cached = await readCache(cacheKey, env.caches, FEATURE_TTL_MS);
  if (cached?.catalog?.byEspnId && cached?.meta) return cached;

  const [epa, transfer, coaches, returning, playerStats] = await Promise.all([
    firstSuccessfulCfbdRequest(env, [["/ppa/teams", { year: season }], ["/ppa/teams/season", { year: season }]], fetchFn),
    firstSuccessfulCfbdRequest(env, [["/player/portal", { year: season }], ["/player/transfer", { year: season }]], fetchFn),
    firstSuccessfulCfbdRequest(env, [["/coaches", { year: season }], ["/coaches/teams", { year: season }]], fetchFn),
    firstSuccessfulCfbdRequest(env, [["/player/returning", { year: season }]], fetchFn),
    firstSuccessfulCfbdRequest(env, [["/stats/player/season", { year: season - 1, category: "passing" }], ["/player/season/stats", { year: season - 1, category: "passing" }]], fetchFn),
  ]);

  const report = [...epa.report, ...transfer.report, ...coaches.report, ...returning.report, ...playerStats.report];
  const catalog = buildCfbFeatureCatalog({
    epa: epa.rows,
    transfers: transfer.rows,
    playerStats: playerStats.rows,
    coaches: coaches.rows,
    returning: returning.rows,
    year: season,
    asOf,
  });
  const records = Object.keys(catalog.byEspnId || {}).length;
  const meta = cfbdPublicMeta({
    configured: true,
    records,
    year: season,
    asOf,
    source: "cfbd-features",
    fallback: records < 20,
    httpStatus: 200,
    endpoints: report,
    error: records ? null : "cfbd-features-empty",
  });
  const payload = { season, asOf, catalog, meta };
  await writeCache(cacheKey, payload, env.caches, records ? FEATURE_TTL_MS : ERR_TTL_MS);
  return payload;
}

function cbbSeasonYear(date = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 10 ? y : y - 1;
}

async function fetchRatingsYear(env, year, fetchFn) {
  const [sp, fpi] = await Promise.all([
    cfbdRequest(CFBD_BASE, "/ratings/sp", env, { query: { year }, fetchFn }),
    cfbdRequest(CFBD_BASE, "/ratings/fpi", env, { query: { year }, fetchFn }),
  ]);
  return {
    sp,
    fpi,
    report: [
      { path: "/ratings/sp", status: sp.status, n: sp.n || 0, ok: sp.ok },
      { path: "/ratings/fpi", status: fpi.status, n: fpi.n || 0, ok: fpi.ok },
    ],
  };
}

async function fetchFbsTeams(env, year, fetchFn) {
  let res = await cfbdRequest(CFBD_BASE, "/teams/fbs", env, { query: { year }, fetchFn });
  if (res.ok && res.n) return { ...res, path: "/teams/fbs" };
  res = await cfbdRequest(CFBD_BASE, "/teams", env, { query: { year, classification: "fbs" }, fetchFn });
  return { ...res, path: "/teams" };
}

function slimSp(rows) {
  return (rows || []).map((r) => ({
    year: r.year,
    team: r.team,
    conference: r.conference,
    rating: r.rating,
    offense: r.offense ? { rating: r.offense.rating } : null,
    defense: r.defense ? { rating: r.defense.rating, ranking: r.defense.ranking } : null,
  }));
}

function slimNamed(rows, fields) {
  return (rows || []).map((r) => {
    const out = { team: r.team || r.school, school: r.school || r.team, conference: r.conference };
    for (const f of fields) out[f] = r[f];
    return out;
  });
}

function fallbackPrior(cacheKey, env, meta) {
  const payload = { version: CFB_PRIOR_VERSION, catalog: PRIOR, meta };
  return writeCache(cacheKey, payload, env.caches, ERR_TTL_MS).then(() => payload);
}

export async function loadCfbPrior(env = {}, { fetchFn = fetch, now = Date.now() } = {}) {
  const asOf = new Date(now).toISOString();
  const season = cfbSeasonYear(new Date(now));
  if (!cfbdConfigured(env)) {
    return {
      version: CFB_PRIOR_VERSION,
      catalog: PRIOR,
      meta: emptyFallbackMeta({ configured: false, error: "no-api-key", year: season, asOf }),
    };
  }

  const cacheKey = `cfb-prior-v2-cfbd-${season}`;
  const cached = await readCache(cacheKey, env.caches, PRIOR_TTL_MS);
  if (cached?.catalog?.byEspnId && cached?.meta) {
    return { version: cached.version, catalog: cached.catalog, meta: cfbdPublicMeta(cached.meta) };
  }

  let year = season;
  let core = await fetchRatingsYear(env, year, fetchFn);
  if ((core.sp.n || 0) + (core.fpi.n || 0) === 0 && core.sp.status !== 401 && core.fpi.status !== 401) {
    year = season - 1;
    core = await fetchRatingsYear(env, year, fetchFn);
  }

  const report = [...core.report];
  const unauthorized = report.some((e) => e.status === 401);
  if (unauthorized || (core.sp.n || 0) + (core.fpi.n || 0) === 0) {
    const status = unauthorized ? 401 : core.sp.status || core.fpi.status || 0;
    return fallbackPrior(
      cacheKey,
      env,
      emptyFallbackMeta({
        configured: true,
        fallback: true,
        httpStatus: status,
        endpoints: report,
        year,
        asOf,
        error: unauthorized ? "CFBD 401" : "cfbd-empty",
      })
    );
  }

  const extras = await Promise.all([
    cfbdRequest(CFBD_BASE, "/ratings/srs/expanded", env, { query: { year }, fetchFn }),
    cfbdRequest(CFBD_BASE, "/talent", env, { query: { year }, fetchFn }),
    cfbdRequest(CFBD_BASE, "/player/returning", env, { query: { year }, fetchFn }),
  ]);
  const [srsExpanded, talent, returning] = extras;
  report.push(
    { path: "/ratings/srs/expanded", status: srsExpanded.status, n: srsExpanded.n || 0, ok: srsExpanded.ok },
    { path: "/talent", status: talent.status, n: talent.n || 0, ok: talent.ok },
    { path: "/player/returning", status: returning.status, n: returning.n || 0, ok: returning.ok }
  );

  const prevTeams = await fetchFbsTeams(env, year === season ? year - 1 : year, fetchFn);
  report.push({ path: prevTeams.path || "/teams/fbs", status: prevTeams.status, n: prevTeams.n || 0, ok: prevTeams.ok, note: "prev-fbs" });

  const built = buildCfbdCatalog({
    sp: slimSp(core.sp.data || []),
    fpi: slimNamed(core.fpi.data || [], ["fpi"]),
    srs: slimNamed(srsExpanded.data || [], ["rating", "classification"]),
    elo: [],
    talent: slimNamed(talent.data || [], ["talent"]),
    returning: slimNamed(returning.data || [], ["percentPPA", "usage"]),
    teams: [],
    prevFbs: (prevTeams.data || []).map((t) => t.school || t.team),
    year,
    asOf,
  });
  const catalog = mergePriorCatalog(built, PRIOR);
  const used = [
    core.sp.n ? "sp" : null,
    core.fpi.n ? "fpi" : null,
    srsExpanded.n ? "srs" : null,
    talent.n ? "talent" : null,
    returning.n ? "returning" : null,
  ].filter(Boolean);
  const meta = cfbdPublicMeta({
    configured: true,
    records: built.nTeams,
    asOf,
    year,
    version: CFB_PRIOR_VERSION_CFBD,
    source: `cfbd:${used.join("+")}`,
    fallback: built.nTeams <= 25,
    httpStatus: 200,
    endpoints: report,
    unmatched: built.unmatched,
    fbs: built.fbs,
    fcs: built.fcs,
    provisional: built.provisional,
    error: built.nTeams <= 25 ? "cfbd-coverage-below-fbs" : null,
  });
  const version = built.nTeams > 25 ? CFB_PRIOR_VERSION_CFBD : CFB_PRIOR_VERSION;
  await writeCache(cacheKey, { version, catalog, meta }, env.caches, PRIOR_TTL_MS);
  return { version, catalog, meta };
}

export function lookupPrior(team, catalog) {
  if (catalog) {
    const hit = priorForTeam(team, catalog);
    if (hit) return hit;
  }
  return priorForTeam(team);
}

export async function loadCbbdRatings(env = {}, { fetchFn = fetch, now = Date.now() } = {}) {
  const asOf = new Date(now).toISOString();
  const season = cbbSeasonYear(new Date(now));
  const limitation = "CBB CFBD ratings are research-only this pass; no independent CBB score model is wired.";
  if (!cfbdConfigured(env)) {
    return { catalog: null, meta: cfbdPublicMeta({ configured: false, fallback: true, year: season, asOf, limitation, error: "no-api-key" }) };
  }
  const cacheKey = `cbbd-ratings-${season}`;
  const cached = await readCache(cacheKey, env.caches, PRIOR_TTL_MS);
  if (cached?.meta) return cached;

  const endpoints = [
    ["/ratings/adjusted", { season }],
    ["/ratings/srs", { season }],
    ["/ratings/elo", { season }],
  ];
  const report = [];
  let records = 0;
  let httpStatus = 200;
  let unauthorized = false;
  for (const [path, query] of endpoints) {
    const res = await cfbdRequest(CBBD_BASE, path, env, { query, fetchFn });
    report.push({ path, status: res.status, n: res.n || 0, ok: res.ok });
    if (res.ok) records += res.n || 0;
    if (res.status === 401) unauthorized = true;
    if (!res.ok && res.status) httpStatus = res.status;
  }
  const meta = cfbdPublicMeta({
    configured: true,
    records,
    asOf,
    year: season,
    source: "cbbd",
    fallback: true,
    httpStatus: unauthorized ? 401 : records ? 200 : httpStatus,
    endpoints: report,
    limitation,
    error: unauthorized ? "CBBD 401" : records ? null : "cbbd-empty-or-unavailable",
  });
  const payload = { catalog: null, meta };
  await writeCache(cacheKey, payload, env.caches, records ? PRIOR_TTL_MS : ERR_TTL_MS);
  return payload;
}
