/**
 * KenPom CBB API adapter.
 * Auth: Authorization: Bearer KENPOM_API_KEY
 * Season parameter uses ending year (2026 = 2025-26).
 *
 * Current refresh uses ratings + four-factors + misc-stats.
 * Archive access is exposed for PIT historical backfill.
 */
import { readCache, writeCache } from "./cache.js";
import { mapSourceTeam } from "./collegeIdentity.js";
import { kenpomApiKey } from "./collegeSecrets.js";

const BASE = "https://kenpom.com/api.php";
const TTL_MS = 12 * 60 * 60 * 1000;
const ERR_TTL_MS = 30 * 60 * 1000;

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
  return String(v || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
function lowerKeys(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([k,v]) => [String(k).toLowerCase(), v]));
}
function pick(row, ...keys) {
  const r = lowerKeys(row);
  for (const key of keys) {
    const v = r[String(key).toLowerCase()];
    if (v != null && v !== "") return v;
  }
  return null;
}
export function kenpomEndingSeason(cbbSeasonStart) {
  const y = Number(cbbSeasonStart);
  return Number.isFinite(y) ? y + 1 : null;
}

async function request(endpoint, env, { params = {}, fetchFn = fetch } = {}) {
  const key = kenpomApiKey(env);
  if (!key) return { ok:false, status:0, endpoint, error:"kenpom-api-key-missing", data:[] };

  const qs = new URLSearchParams({ endpoint, ...Object.fromEntries(Object.entries(params).filter(([,v])=>v!=null && v!=="")) });
  try {
    const res = await fetchFn(`${BASE}?${qs.toString()}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "User-Agent": "FBIS-CBB/2.0",
      },
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) return { ok:false, status:res.status, endpoint, error:`kenpom-http-${res.status}`, data:[] };
    if (!Array.isArray(data)) return { ok:false, status:res.status, endpoint, error:"kenpom-unexpected-payload", data:[] };
    return { ok:true, status:res.status, endpoint, data, n:data.length };
  } catch (err) {
    return { ok:false, status:0, endpoint, error:String(err?.message || err), data:[] };
  }
}

export function normalizeKenPomRatings(rows = []) {
  return rows.map((raw) => {
    const team = pick(raw, "TeamName", "team");
    return {
      team: team ? String(team).trim() : null,
      teamId: pick(raw, "TeamID", "team_id"),
      conference: pick(raw, "ConfShort", "conference"),
      dataThrough: pick(raw, "DataThrough"),
      adjEm: num(pick(raw, "AdjEM")),
      adjOe: num(pick(raw, "AdjOE")),
      adjDe: num(pick(raw, "AdjDE")),
      tempo: num(pick(raw, "AdjTempo", "Tempo")),
      luck: num(pick(raw, "Luck")),
      sos: num(pick(raw, "SOS")),
      sosO: num(pick(raw, "SOSO")),
      sosD: num(pick(raw, "SOSD")),
      ncSos: num(pick(raw, "NCSOS")),
      aplOff: num(pick(raw, "APL_Off")),
      aplDef: num(pick(raw, "APL_Def")),
      source: "kenpom",
    };
  }).filter(r => r.team && r.adjOe != null && r.adjDe != null);
}

export function normalizeKenPomFourFactors(rows = []) {
  return rows.map((raw) => ({
    team: String(pick(raw, "TeamName", "team") || "").trim(),
    efgPct: pct(pick(raw, "eFG_Pct")),
    tovRate: pct(pick(raw, "TO_Pct")),
    orbRate: pct(pick(raw, "OR_Pct")),
    ftr: pct(pick(raw, "FT_Rate")),
    efgPctD: pct(pick(raw, "DeFG_Pct")),
    tovRateD: pct(pick(raw, "DTO_Pct")),
    drbRate: pct(pick(raw, "DOR_Pct")),
    ftrD: pct(pick(raw, "DFT_Rate")),
    adjOe: num(pick(raw, "AdjOE")),
    adjDe: num(pick(raw, "AdjDE")),
    tempo: num(pick(raw, "AdjTempo")),
  })).filter(r => r.team);
}

export function normalizeKenPomMisc(rows = []) {
  return rows.map((raw) => ({
    team: String(pick(raw, "TeamName", "team") || "").trim(),
    threePtPct: pct(pick(raw, "FG3Pct")),
    twoPtPct: pct(pick(raw, "FG2Pct")),
    ftPct: pct(pick(raw, "FTPct")),
    oppThreePtPct: pct(pick(raw, "OppFG3Pct")),
    oppTwoPtPct: pct(pick(raw, "OppFG2Pct")),
    oppFtPct: pct(pick(raw, "OppFTPct")),
    stealRate: pct(pick(raw, "StlRate")),
    assistRate: pct(pick(raw, "ARate")),
    threePtRate: pct(pick(raw, "F3GRate")),
  })).filter(r => r.team);
}

export function indexKenPomRows(rows = [], cbbSeasonStart) {
  const byCanonicalId = {}, byEspnId = {}, bySchool = {};
  let matched = 0, unmatched = 0;
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
  return { byCanonicalId, byEspnId, bySchool, matched, unmatched, n:rows.length };
}

export function lookupKenPomRating(catalog, team) {
  if (!catalog) return null;
  const school = String(team?.school || team?.name || team?.fullName || "").toLowerCase();
  const loose = teamKey(team?.school || team?.name || team?.fullName || "");
  return catalog.byCanonicalId?.[team?.canonicalId]
    || catalog.byEspnId?.[String(team?.espnId || "")]
    || catalog.bySchool?.[school]
    || catalog.bySchool?.[loose]
    || null;
}

export async function loadKenPomCbbCatalog(env = {}, { cbbSeason, fetchFn = fetch } = {}) {
  const seasonStart = Number(cbbSeason);
  const endingSeason = kenpomEndingSeason(seasonStart);
  if (!Number.isFinite(endingSeason)) return { ok:false, configured:Boolean(kenpomApiKey(env)), rows:[], byCanonicalId:{}, error:"invalid-season" };

  const cacheKey = `kenpom-cbb-v1-${endingSeason}`;
  const cached = await readCache(cacheKey, env.caches, TTL_MS);
  if (cached?.byCanonicalId) return cached;

  const [ratingsRes, fourRes, miscRes] = await Promise.all([
    request("ratings", env, { params:{ y:endingSeason }, fetchFn }),
    request("four-factors", env, { params:{ y:endingSeason }, fetchFn }),
    request("misc-stats", env, { params:{ y:endingSeason }, fetchFn }),
  ]);

  if (!ratingsRes.ok) {
    const fail = {
      ok:false,
      configured:Boolean(kenpomApiKey(env)),
      cbbSeason:seasonStart,
      kenpomSeason:endingSeason,
      rows:[],
      byCanonicalId:{}, byEspnId:{}, bySchool:{},
      matched:0, unmatched:0, n:0,
      error:ratingsRes.error || "kenpom-ratings-unavailable",
      httpStatus:ratingsRes.status || 0,
      asOf:new Date().toISOString(),
      source:"kenpom-api",
    };
    await writeCache(cacheKey, fail, env.caches, ERR_TTL_MS);
    return fail;
  }

  const ratings = normalizeKenPomRatings(ratingsRes.data);
  const four = fourRes.ok ? normalizeKenPomFourFactors(fourRes.data) : [];
  const misc = miscRes.ok ? normalizeKenPomMisc(miscRes.data) : [];
  const fourBy = new Map(four.map(r=>[teamKey(r.team),r]));
  const miscBy = new Map(misc.map(r=>[teamKey(r.team),r]));
  const rows = ratings.map(r=>({
    ...r,
    ...(fourBy.get(teamKey(r.team)) || {}),
    ...(miscBy.get(teamKey(r.team)) || {}),
    adjOe:r.adjOe,
    adjDe:r.adjDe,
    tempo:r.tempo,
    source:"kenpom",
  }));
  const index = indexKenPomRows(rows, seasonStart);
  const out = {
    ok: rows.length > 0,
    configured:true,
    cbbSeason:seasonStart,
    kenpomSeason:endingSeason,
    ...index,
    rows,
    asOf:new Date().toISOString(),
    ratingsHttpStatus:ratingsRes.status,
    fourFactorsHttpStatus:fourRes.status || 0,
    miscHttpStatus:miscRes.status || 0,
    fourFactorsAvailable:four.length > 0,
    miscAvailable:misc.length > 0,
    source:"kenpom-api",
  };
  await writeCache(cacheKey, out, env.caches, out.ok ? TTL_MS : ERR_TTL_MS);
  return out;
}

export async function loadKenPomArchive(env = {}, { date, endingSeason, preseason = false, fetchFn = fetch } = {}) {
  const params = date ? { d:date } : { y:endingSeason, preseason:preseason ? "true" : undefined };
  return request("archive", env, { params, fetchFn });
}
