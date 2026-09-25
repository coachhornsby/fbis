/**
 * Bart Torvik CBB ratings + four-factor adapter.
 *
 * Torvik labels seasons by ending year (2025-26 => 2026), while CBBD/FBIS
 * uses the season starting year (2025). Raw CSV stays server-side; callers
 * receive normalized team rows only.
 */
import { readCache, writeCache } from "./cache.js";
import { mapSourceTeam } from "./collegeIdentity.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const ERR_TTL_MS = 30 * 60 * 1000;
const BASES = ["https://barttorvik.com", "http://barttorvik.com"];

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function pct(v) {
  const n = num(v);
  if (n == null) return null;
  return Math.abs(n) > 1.5 ? n / 100 : n;
}

function headerKey(v) {
  return String(v || "").replace(/^\uFEFF/, "").trim().toLowerCase();
}

function teamKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseCsvLine(line = "") {
  const out = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(value);
      value = "";
    } else {
      value += ch;
    }
  }
  out.push(value);
  return out;
}

export function parseCsv(text = "") {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map(headerKey);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      if (!h) return;
      if (row[h] === undefined) row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function pick(row, keys) {
  for (const key of keys) {
    const k = headerKey(key);
    if (row?.[k] != null && row[k] !== "") return row[k];
  }
  return null;
}

export function normalizeTorvikTeamRows(text = "") {
  const rows = parseCsv(text);
  const out = [];
  for (const raw of rows) {
    const team = pick(raw, ["team", "teamname", "team name"]);
    if (!team) continue;
    const adjOe = num(pick(raw, ["adjoe", "adj oe", "adj. oe"]));
    const adjDe = num(pick(raw, ["adjde", "adj de", "adj. de"]));
    const tempo = num(pick(raw, ["adj t.", "adj t", "adjt", "adjtempo", "adj tempo"]));
    if (adjOe == null || adjDe == null) continue;
    out.push({
      team: String(team).trim(),
      conference: pick(raw, ["conf", "conference"]),
      games: num(pick(raw, ["g", "games"])),
      adjOe,
      adjDe,
      tempo,
      barthag: num(pick(raw, ["barthag"])),
      wab: num(pick(raw, ["wab"])),
      source: "torvik",
    });
  }
  return out;
}

/**
 * fffinal.csv has duplicate rank column names. Parse by documented position
 * rather than trusting the header.
 */
export function normalizeTorvikFourFactorRows(text = "") {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    if (c.length < 24 || !String(c[0] || "").trim()) continue;
    out.push({
      team: String(c[0]).trim(),
      efgPct: pct(c[1]),
      efgPctD: pct(c[3]),
      ftr: pct(c[5]),
      ftrD: pct(c[7]),
      orbRate: pct(c[9]),
      drbRate: pct(c[11]),
      tovRate: pct(c[13]),
      tovRateD: pct(c[15]),
      threePtPct: pct(c[17]),
      threePtPctD: pct(c[19]),
      twoPtPct: pct(c[21]),
      twoPtPctD: pct(c[23]),
    });
  }
  return out;
}

async function fetchText(path, fetchFn) {
  let last = null;
  for (const base of BASES) {
    const url = `${base}/${path}`;
    try {
      const res = await fetchFn(url, {
        headers: { Accept: "text/csv,*/*", "User-Agent": "FBIS-CBB/2.0" },
      });
      if (res.ok) return { ok: true, status: res.status, url, text: await res.text() };
      last = { ok: false, status: res.status, url, error: `HTTP ${res.status}` };
    } catch (err) {
      last = { ok: false, status: 0, url, error: String(err?.message || err) };
    }
  }
  return last || { ok: false, status: 0, error: "torvik-fetch-failed" };
}

export function torvikEndingSeason(cbbSeasonStart) {
  const y = Number(cbbSeasonStart);
  return Number.isFinite(y) ? y + 1 : null;
}

export function indexTorvikRows(rows = [], cbbSeasonStart) {
  const byCanonicalId = {};
  const byEspnId = {};
  const bySchool = {};
  let matched = 0;
  let unmatched = 0;

  for (const row of rows) {
    const mapped = mapSourceTeam("cbb", { team: row.team, school: row.team }, cbbSeasonStart);
    const rec = {
      ...row,
      canonicalId: mapped.ok ? mapped.canonicalId : null,
      espnId: mapped.ok ? mapped.espnId : null,
      school: mapped.ok ? mapped.school : row.team,
    };
    if (mapped.ok) {
      matched += 1;
      byCanonicalId[mapped.canonicalId] = rec;
      if (mapped.espnId) byEspnId[String(mapped.espnId)] = rec;
      bySchool[String(mapped.school).toLowerCase()] = rec;
    } else {
      unmatched += 1;
      bySchool[teamKey(row.team)] = rec;
    }
  }
  return { byCanonicalId, byEspnId, bySchool, matched, unmatched, n: rows.length };
}

export function lookupTorvikRating(catalog, team) {
  if (!catalog) return null;
  const school = String(team?.school || team?.name || team?.fullName || "").toLowerCase();
  const loose = teamKey(team?.school || team?.name || team?.fullName || "");
  return (
    catalog.byCanonicalId?.[team?.canonicalId] ||
    catalog.byEspnId?.[String(team?.espnId || "")] ||
    catalog.bySchool?.[school] ||
    catalog.bySchool?.[loose] ||
    null
  );
}

export function mergeCbbCatalogs(cbbd = {}, torvik = {}, kenpom = {}) {
  const ids = new Set([
    ...Object.keys(cbbd.byCanonicalId || {}),
    ...Object.keys(torvik.byCanonicalId || {}),
    ...Object.keys(kenpom.byCanonicalId || {}),
  ]);
  const byCanonicalId = {};
  const byEspnId = {};
  const bySchool = {};

  for (const id of ids) {
    const primary = cbbd.byCanonicalId?.[id] || null;
    const secondary = torvik.byCanonicalId?.[id] || null;
    const tertiary = kenpom.byCanonicalId?.[id] || null;
    const row = {
      ...(primary || {}),
      canonicalId: id,
      sourceCoverage: { cbbd: Boolean(primary), torvik: Boolean(secondary), kenpom: Boolean(tertiary) },
      torvik: secondary
        ? {
            adjOe: secondary.adjOe,
            adjDe: secondary.adjDe,
            tempo: secondary.tempo,
            barthag: secondary.barthag,
            wab: secondary.wab,
            efgPct: secondary.efgPct,
            efgPctD: secondary.efgPctD,
            tovRate: secondary.tovRate,
            tovRateD: secondary.tovRateD,
            orbRate: secondary.orbRate,
            drbRate: secondary.drbRate,
            ftr: secondary.ftr,
            ftrD: secondary.ftrD,
            twoPtPct: secondary.twoPtPct,
            twoPtPctD: secondary.twoPtPctD,
            threePtPct: secondary.threePtPct,
            threePtPctD: secondary.threePtPctD,
          }
        : null,
      kenpom: tertiary
        ? {
            adjEm: tertiary.adjEm,
            adjOe: tertiary.adjOe,
            adjDe: tertiary.adjDe,
            tempo: tertiary.tempo,
            luck: tertiary.luck,
            sos: tertiary.sos,
            sosO: tertiary.sosO,
            sosD: tertiary.sosD,
            ncSos: tertiary.ncSos,
            aplOff: tertiary.aplOff,
            aplDef: tertiary.aplDef,
            efgPct: tertiary.efgPct,
            efgPctD: tertiary.efgPctD,
            tovRate: tertiary.tovRate,
            tovRateD: tertiary.tovRateD,
            orbRate: tertiary.orbRate,
            drbRate: tertiary.drbRate,
            ftr: tertiary.ftr,
            ftrD: tertiary.ftrD,
            threePtPct: tertiary.threePtPct,
            twoPtPct: tertiary.twoPtPct,
            ftPct: tertiary.ftPct,
            oppThreePtPct: tertiary.oppThreePtPct,
            oppTwoPtPct: tertiary.oppTwoPtPct,
            oppFtPct: tertiary.oppFtPct,
          }
        : null,
    };
    byCanonicalId[id] = row;
    const espnId = primary?.espnId || secondary?.espnId || tertiary?.espnId;
    const school = primary?.school || secondary?.school || tertiary?.school || secondary?.team || tertiary?.team;
    if (espnId) byEspnId[String(espnId)] = row;
    if (school) bySchool[String(school).toLowerCase()] = row;
  }

  return {
    byCanonicalId,
    byEspnId,
    bySchool,
    matched: ids.size,
    unmatched: Number(cbbd.unmatched || 0) + Number(torvik.unmatched || 0) + Number(kenpom.unmatched || 0),
    n: ids.size,
    sourceCoverage: {
      cbbdTeams: Object.keys(cbbd.byCanonicalId || {}).length,
      torvikTeams: Object.keys(torvik.byCanonicalId || {}).length,
      kenpomTeams: Object.keys(kenpom.byCanonicalId || {}).length,
      mergedTeams: ids.size,
    },
  };
}

export async function loadTorvikCbbCatalog(env = {}, { cbbSeason, fetchFn = fetch } = {}) {
  const seasonStart = Number(cbbSeason);
  const endingSeason = torvikEndingSeason(seasonStart);
  if (!Number.isFinite(endingSeason)) {
    return { ok: false, configured: true, rows: [], byCanonicalId: {}, error: "invalid-season" };
  }

  const cacheKey = `torvik-cbb-v2-${endingSeason}`;
  const cached = await readCache(cacheKey, env.caches, TTL_MS);
  if (cached?.byCanonicalId) return cached;

  const [ratingsRes, fourRes] = await Promise.all([
    fetchText(`${endingSeason}_team_results.csv`, fetchFn),
    fetchText(`${endingSeason}_fffinal.csv`, fetchFn),
  ]);

  if (!ratingsRes.ok) {
    const fail = {
      ok: false,
      configured: true,
      cbbSeason: seasonStart,
      torvikSeason: endingSeason,
      rows: [],
      byCanonicalId: {},
      byEspnId: {},
      bySchool: {},
      matched: 0,
      unmatched: 0,
      n: 0,
      error: ratingsRes.error || "torvik-ratings-unavailable",
      httpStatus: ratingsRes.status || 0,
      asOf: new Date().toISOString(),
    };
    await writeCache(cacheKey, fail, env.caches, ERR_TTL_MS);
    return fail;
  }

  const ratings = normalizeTorvikTeamRows(ratingsRes.text);
  const four = fourRes.ok ? normalizeTorvikFourFactorRows(fourRes.text) : [];
  const fourByTeam = new Map(four.map((row) => [teamKey(row.team), row]));
  const rows = ratings.map((row) => ({ ...row, ...(fourByTeam.get(teamKey(row.team)) || {}) }));
  const index = indexTorvikRows(rows, seasonStart);
  const out = {
    ok: rows.length > 0,
    configured: true,
    cbbSeason: seasonStart,
    torvikSeason: endingSeason,
    ...index,
    rows,
    asOf: new Date().toISOString(),
    ratingsHttpStatus: ratingsRes.status,
    fourFactorHttpStatus: fourRes.status || 0,
    fourFactorAvailable: four.length > 0,
    source: "barttorvik-public-csv",
  };
  await writeCache(cacheKey, out, env.caches, out.ok ? TTL_MS : ERR_TTL_MS);
  return out;
}
