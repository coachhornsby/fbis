/**
 * KenPom CBB adapter.
 *
 * Auth: Authorization: Bearer KENPOM_API_KEY
 * Independent sports data only. FanMatch is intentionally excluded from the
 * PURE feature pipeline because it is already a provider projection.
 */
import { readCache, writeCache } from "./cache.js";
import { mapSourceTeam } from "./collegeIdentity.js";

const BASE = "https://kenpom.com/api.php";
const TTL_MS = 6 * 60 * 60 * 1000;
const ERR_TTL_MS = 15 * 60 * 1000;

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v) {
  const n = num(v);
  if (n == null) return null;
  return Math.abs(n) > 1.5 ? n / 100 : n;
}

function teamKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function kenpomEndingSeason(cbbSeasonStart) {
  const y = Number(cbbSeasonStart);
  return Number.isFinite(y) ? y + 1 : null;
}

export function normalizeKenpomRatingRows(rows = []) {
  return (rows || []).map((row) => ({
    team: row.TeamName ?? row.team ?? row.teamName ?? null,
    conference: row.ConfShort ?? row.confShort ?? row.conference ?? null,
    adjEm: num(row.AdjEM ?? row.adjEM ?? row.adjEm),
    adjOe: num(row.AdjOE ?? row.adjOE ?? row.adjOe),
    adjDe: num(row.AdjDE ?? row.adjDE ?? row.adjDe),
    tempo: num(row.AdjTempo ?? row.adjTempo ?? row.Tempo ?? row.tempo),
    luck: num(row.Luck ?? row.luck),
    sos: num(row.SOS ?? row.sos),
    sosO: num(row.SOSO ?? row.sosO),
    sosD: num(row.SOSD ?? row.sosD),
    dataThrough: row.DataThrough ?? row.dataThrough ?? null,
    source: "kenpom",
  })).filter((row) => row.team && row.adjOe != null && row.adjDe != null);
}

export function normalizeKenpomFourFactorRows(rows = []) {
  return (rows || []).map((row) => ({
    team: row.TeamName ?? row.team ?? row.teamName ?? null,
    efgPct: pct(row.eFG_Pct ?? row.efg_pct ?? row.eFGPct),
    tovRate: pct(row.TO_Pct ?? row.to_pct ?? row.TOPct),
    orbRate: pct(row.OR_Pct ?? row.or_pct ?? row.ORPct),
    ftr: pct(row.FT_Rate ?? row.ft_rate ?? row.FTRate),
    efgPctD: pct(row.DeFG_Pct ?? row.defg_pct ?? row.DeFGPct),
    tovRateD: pct(row.DTO_Pct ?? row.dto_pct ?? row.DTOPct),
    drbRate: pct(row.DOR_Pct ?? row.dor_pct ?? row.DORPct),
    ftrD: pct(row.DFT_Rate ?? row.dft_rate ?? row.DFTRate),
    adjOe: num(row.AdjOE ?? row.adjOE ?? row.adjOe),
    adjDe: num(row.AdjDE ?? row.adjDE ?? row.adjDe),
    tempo: num(row.AdjTempo ?? row.adjTempo ?? row.Tempo ?? row.tempo),
    dataThrough: row.DataThrough ?? row.dataThrough ?? null,
  })).filter((row) => row.team);
}

async function fetchEndpoint(endpoint, season, env = {}, fetchFn = fetch) {
  const key = String(env?.KENPOM_API_KEY || "").trim();
  if (!key) return { ok: false, status: 0, error: "no-api-key", data: [] };
  const url = new URL(BASE);
  url.searchParams.set("endpoint", endpoint);
  url.searchParams.set("y", String(season));
  try {
    const res = await fetchFn(url.toString(), {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "User-Agent": "FBIS-CBB/2.0",
      },
    });
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}`, data: [] };
    if (!Array.isArray(body)) return { ok: false, status: res.status, error: "unexpected-payload", data: [] };
    return { ok: true, status: res.status, data: body };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err), data: [] };
  }
}

export function indexKenpomRows(rows = [], cbbSeasonStart) {
  const byCanonicalId = {};
  const byEspnId = {};
  const bySchool = {};
  let matched = 0;
  let unmatched = 0;
  for (const row of rows || []) {
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

export function lookupKenpomRating(catalog, team) {
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

export async function loadKenpomCbbCatalog(env = {}, { cbbSeason, fetchFn = fetch } = {}) {
  const seasonStart = Number(cbbSeason);
  const endingSeason = kenpomEndingSeason(seasonStart);
  if (!Number.isFinite(endingSeason)) {
    return { ok: false, configured: Boolean(env?.KENPOM_API_KEY), rows: [], byCanonicalId: {}, error: "invalid-season" };
  }
  if (!env?.KENPOM_API_KEY) {
    return {
      ok: false,
      configured: false,
      cbbSeason: seasonStart,
      kenpomSeason: endingSeason,
      rows: [],
      byCanonicalId: {},
      byEspnId: {},
      bySchool: {},
      matched: 0,
      unmatched: 0,
      n: 0,
      error: "no-api-key",
      asOf: new Date().toISOString(),
    };
  }

  const cacheKey = `kenpom-cbb-v1-${endingSeason}`;
  const cached = await readCache(cacheKey, env.caches, TTL_MS);
  if (cached?.byCanonicalId) return { ...cached, cacheHit: true };

  const [ratingsRes, fourRes] = await Promise.all([
    fetchEndpoint("ratings", endingSeason, env, fetchFn),
    fetchEndpoint("four-factors", endingSeason, env, fetchFn),
  ]);
  if (!ratingsRes.ok) {
    const fail = {
      ok: false,
      configured: true,
      cbbSeason: seasonStart,
      kenpomSeason: endingSeason,
      rows: [],
      byCanonicalId: {},
      byEspnId: {},
      bySchool: {},
      matched: 0,
      unmatched: 0,
      n: 0,
      error: ratingsRes.error || "kenpom-ratings-unavailable",
      httpStatus: ratingsRes.status || 0,
      asOf: new Date().toISOString(),
    };
    await writeCache(cacheKey, fail, env.caches, ERR_TTL_MS);
    return fail;
  }

  const ratings = normalizeKenpomRatingRows(ratingsRes.data);
  const four = fourRes.ok ? normalizeKenpomFourFactorRows(fourRes.data) : [];
  const fourByTeam = new Map(four.map((row) => [teamKey(row.team), row]));
  const rows = ratings.map((row) => ({ ...row, ...(fourByTeam.get(teamKey(row.team)) || {}) }));
  const index = indexKenpomRows(rows, seasonStart);
  const dataThrough = rows.map((r) => r.dataThrough).find(Boolean) || null;
  const out = {
    ok: rows.length >= 300,
    configured: true,
    cbbSeason: seasonStart,
    kenpomSeason: endingSeason,
    ...index,
    rows,
    dataThrough,
    asOf: new Date().toISOString(),
    ratingsHttpStatus: ratingsRes.status,
    fourFactorHttpStatus: fourRes.status || 0,
    fourFactorAvailable: four.length > 0,
    source: "kenpom-api",
    cacheHit: false,
  };
  if (!out.ok) out.error = `kenpom-row-count-${rows.length}`;
  await writeCache(cacheKey, out, env.caches, out.ok ? TTL_MS : ERR_TTL_MS);
  return out;
}
