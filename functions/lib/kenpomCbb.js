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
    aplOff: num(row.APL_Off ?? row.aplOff),
    aplDef: num(row.APL_Def ?? row.aplDef),
    dataThrough: row.DataThrough ?? row.dataThrough ?? null,
    source: "kenpom",
  })).filter((row) => row.team && row.adjOe != null && row.adjDe != null);
}

export function normalizeKenpomFanmatchRows(rows = []) {
  return (rows || []).map((row) => {
    const homePred = num(row.HomePred ?? row.homePred);
    const awayPred = num(row.VisitorPred ?? row.visitorPred ?? row.AwayPred ?? row.awayPred);
    const rawWp = num(row.HomeWP ?? row.homeWP ?? row.homeWinProbability);
    return {
      season: num(row.Season ?? row.season),
      gameId: row.GameID ?? row.gameId ?? null,
      date: row.DateOfGame ?? row.date ?? null,
      awayTeam: row.Visitor ?? row.visitor ?? row.Away ?? row.away ?? null,
      homeTeam: row.Home ?? row.home ?? null,
      awayRank: num(row.VisitorRank ?? row.visitorRank),
      homeRank: num(row.HomeRank ?? row.homeRank),
      awayPred,
      homePred,
      homeMargin: homePred != null && awayPred != null ? homePred - awayPred : null,
      total: homePred != null && awayPred != null ? homePred + awayPred : null,
      homeWinProbability: rawWp == null ? null : (rawWp > 1 ? rawWp / 100 : rawWp),
      predTempo: num(row.PredTempo ?? row.predTempo),
      thrillScore: num(row.ThrillScore ?? row.thrillScore),
      source: "kenpom-fanmatch",
      comparisonOnly: true,
    };
  }).filter((row) => row.date && row.awayTeam && row.homeTeam && row.homePred != null && row.awayPred != null);
}

export async function loadKenpomFanmatch(env = {}, { date, fetchFn = fetch } = {}) {
  const key = String(env?.KENPOM_API_KEY || "").trim();
  if (!key) return { ok: false, configured: false, date, rows: [], n: 0, error: "no-api-key", comparisonOnly: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    return { ok: false, configured: true, date, rows: [], n: 0, error: "invalid-date", comparisonOnly: true };
  }
  const url = new URL(BASE);
  url.searchParams.set("endpoint", "fanmatch");
  url.searchParams.set("d", String(date));
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
    if (!res.ok) return { ok: false, configured: true, date, rows: [], n: 0, httpStatus: res.status, error: `HTTP ${res.status}`, comparisonOnly: true };
    if (!Array.isArray(body)) return { ok: false, configured: true, date, rows: [], n: 0, httpStatus: res.status, error: "unexpected-payload", comparisonOnly: true };
    const rows = normalizeKenpomFanmatchRows(body);
    return { ok: true, configured: true, date, rows, n: rows.length, httpStatus: res.status, comparisonOnly: true, source: "kenpom-fanmatch" };
  } catch (err) {
    return { ok: false, configured: true, date, rows: [], n: 0, httpStatus: 0, error: String(err?.message || err), comparisonOnly: true };
  }
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


export function normalizeKenpomPointDistRows(rows = []) {
  return (rows || []).map((row) => ({
    team: row.TeamName ?? row.team ?? row.teamName ?? null,
    pointsFromFt: pct(row.OffFt ?? row.offFt),
    pointsFrom2: pct(row.OffFg2 ?? row.offFg2),
    pointsFrom3: pct(row.OffFg3 ?? row.offFg3),
    pointsAllowedFt: pct(row.DefFt ?? row.defFt),
    pointsAllowed2: pct(row.DefFg2 ?? row.defFg2),
    pointsAllowed3: pct(row.DefFg3 ?? row.defFg3),
    dataThrough: row.DataThrough ?? row.dataThrough ?? null,
  })).filter((row) => row.team);
}

export function normalizeKenpomHeightRows(rows = []) {
  return (rows || []).map((row) => ({
    team: row.TeamName ?? row.team ?? row.teamName ?? null,
    avgHeight: num(row.AvgHgt ?? row.avgHgt),
    effectiveHeight: num(row.HgtEff ?? row.hgtEff),
    height5: num(row.Hgt5 ?? row.hgt5),
    height4: num(row.Hgt4 ?? row.hgt4),
    height3: num(row.Hgt3 ?? row.hgt3),
    height2: num(row.Hgt2 ?? row.hgt2),
    height1: num(row.Hgt1 ?? row.hgt1),
    experience: num(row.Exp ?? row.exp),
    bench: num(row.Bench ?? row.bench),
    continuity: num(row.Continuity ?? row.continuity),
    dataThrough: row.DataThrough ?? row.dataThrough ?? null,
  })).filter((row) => row.team);
}

export function normalizeKenpomMiscRows(rows = []) {
  return (rows || []).map((row) => ({
    team: row.TeamName ?? row.team ?? row.teamName ?? null,
    threePtPct: pct(row.FG3Pct ?? row.fg3Pct),
    twoPtPct: pct(row.FG2Pct ?? row.fg2Pct),
    ftPct: pct(row.FTPct ?? row.ftPct),
    blockPct: pct(row.BlockPct ?? row.blockPct),
    stealRate: pct(row.StlRate ?? row.stlRate),
    nonStealTurnoverRate: pct(row.NSTRate ?? row.nsTRate),
    assistRate: pct(row.ARate ?? row.aRate),
    threePtAttemptRate: pct(row.F3GRate ?? row.f3gRate),
    avg2PtAttemptDistance: num(row.Avg2PADist ?? row.avg2PADist),
    oppThreePtPct: pct(row.OppFG3Pct ?? row.oppFG3Pct),
    oppTwoPtPct: pct(row.OppFG2Pct ?? row.oppFG2Pct),
    oppFtPct: pct(row.OppFTPct ?? row.oppFtPct),
    oppBlockPct: pct(row.OppBlockPct ?? row.oppBlockPct),
    oppStealRate: pct(row.OppStlRate ?? row.oppStlRate),
    oppNonStealTurnoverRate: pct(row.OppNSTRate ?? row.oppNSTRate),
    oppAssistRate: pct(row.OppARate ?? row.oppARate),
    oppThreePtAttemptRate: pct(row.OppF3GRate ?? row.oppF3GRate),
    oppAvg2PtAttemptDistance: num(row.OppAvg2PADist ?? row.oppAvg2PADist),
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

  const cacheKey = `kenpom-cbb-v2-${endingSeason}`;
  const cached = await readCache(cacheKey, env.caches, TTL_MS);
  if (cached?.byCanonicalId) return { ...cached, cacheHit: true };

  const [ratingsRes, fourRes, pointDistRes, heightRes, miscRes] = await Promise.all([
    fetchEndpoint("ratings", endingSeason, env, fetchFn),
    fetchEndpoint("four-factors", endingSeason, env, fetchFn),
    fetchEndpoint("pointdist", endingSeason, env, fetchFn),
    fetchEndpoint("height", endingSeason, env, fetchFn),
    fetchEndpoint("misc-stats", endingSeason, env, fetchFn),
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
  const pointDist = pointDistRes.ok ? normalizeKenpomPointDistRows(pointDistRes.data) : [];
  const height = heightRes.ok ? normalizeKenpomHeightRows(heightRes.data) : [];
  const misc = miscRes.ok ? normalizeKenpomMiscRows(miscRes.data) : [];
  const fourByTeam = new Map(four.map((row) => [teamKey(row.team), row]));
  const pointDistByTeam = new Map(pointDist.map((row) => [teamKey(row.team), row]));
  const heightByTeam = new Map(height.map((row) => [teamKey(row.team), row]));
  const miscByTeam = new Map(misc.map((row) => [teamKey(row.team), row]));
  const rows = ratings.map((row) => ({
    ...row,
    ...(fourByTeam.get(teamKey(row.team)) || {}),
    ...(pointDistByTeam.get(teamKey(row.team)) || {}),
    ...(heightByTeam.get(teamKey(row.team)) || {}),
    ...(miscByTeam.get(teamKey(row.team)) || {}),
  }));
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
    pointDistHttpStatus: pointDistRes.status || 0,
    heightHttpStatus: heightRes.status || 0,
    miscHttpStatus: miscRes.status || 0,
    fourFactorAvailable: four.length > 0,
    pointDistAvailable: pointDist.length > 0,
    heightAvailable: height.length > 0,
    miscAvailable: misc.length > 0,
    featureFamilies: {
      ratings: ratings.length,
      fourFactors: four.length,
      pointDistribution: pointDist.length,
      heightExperienceContinuity: height.length,
      miscStats: misc.length,
    },
    source: "kenpom-api",
    cacheHit: false,
  };
  if (!out.ok) out.error = `kenpom-row-count-${rows.length}`;
  await writeCache(cacheKey, out, env.caches, out.ok ? TTL_MS : ERR_TTL_MS);
  return out;
}
