/**
 * Attach shadow college challengers to a slate game. Champion scores stay unchanged.
 */

import { loadCfbPrior, lookupPrior } from "./cfbd.js";
import { cbbdGet, cbbSeasonYear } from "./collegeApi.js";
import { projectCfbChallengers } from "./cfbRatings.js";
import { projectCbbChallengers, lookupCbbdRating } from "./cbbRatingsSafe.js";
import { readCache, writeCache } from "./cache.js";
import { mapSourceTeam } from "./collegeIdentity.js";
import { MODEL_VERSION } from "./weights.js";
import { loadTorvikCbbCatalog, lookupTorvikRating } from "./torvikCbb.js";
import { loadKenpomCbbCatalog, lookupKenpomRating } from "./kenpomCbb.js";

const CATALOG_TTL = 6 * 60 * 60 * 1000;

function indexCbbd(rows) {
  const byCanonicalId = {};
  const byEspnId = {};
  const bySchool = {};
  let matched = 0;
  let unmatched = 0;
  for (const row of rows || []) {
    const mapped = mapSourceTeam("cbb", row, row.season || row.year);
    const off = Number(row.offensiveRating ?? row.offense?.rating ?? row.adjOe);
    const defn = Number(row.defensiveRating ?? row.defense?.rating ?? row.adjDe);
    const tempo = Number(row.tempo ?? row.adjTempo);
    if (!Number.isFinite(off) || !Number.isFinite(defn)) { unmatched += 1; continue; }
    const rec = { adjOe: off, adjDe: defn, tempo: Number.isFinite(tempo) ? tempo : 68, canonicalId: mapped.ok ? mapped.canonicalId : null, espnId: mapped.ok ? mapped.espnId : null, school: mapped.ok ? mapped.school : row.team || row.school };
    if (mapped.ok) {
      matched += 1;
      byCanonicalId[mapped.canonicalId] = rec;
      if (mapped.espnId) byEspnId[String(mapped.espnId)] = rec;
      bySchool[String(mapped.school).toLowerCase()] = rec;
    } else unmatched += 1;
  }
  return { byCanonicalId, byEspnId, bySchool, matched, unmatched, n: (rows || []).length };
}

export async function loadCbbdCatalog(env = {}, { fetchFn = fetch } = {}) {
  const season = cbbSeasonYear();
  const cacheKey = `cbbd-catalog-${season}`;
  const cached = await readCache(cacheKey, env.caches, CATALOG_TTL);
  if (cached?.byCanonicalId) return cached;
  const res = await cbbdGet("/ratings/adjusted", env, { query: { year: season }, fetchFn });
  if (!res.ok) {
    const empty = { byCanonicalId: {}, byEspnId: {}, bySchool: {}, matched: 0, unmatched: 0, n: 0, error: res.reason, configured: res.reason !== "no-api-key" };
    await writeCache(cacheKey, empty, env.caches, 15 * 60 * 1000);
    return empty;
  }
  const catalog = { ...indexCbbd(res.data || []), asOf: new Date().toISOString(), year: season, configured: true };
  await writeCache(cacheKey, catalog, env.caches, CATALOG_TTL);
  return catalog;
}

export async function attachCfbChallengers(games, env = {}) {
  const prior = await loadCfbPrior(env);
  return (games || []).map((game) => {
    if (game.sport && game.sport !== "cfb") return game;
    const homeRow = lookupPrior(game.home, prior.catalog);
    const awayRow = lookupPrior(game.away, prior.catalog);
    const challengers = projectCfbChallengers(game, { home: { off: homeRow?.off, def: homeRow?.def, talent: homeRow?.talent, returningPct: homeRow?.returningPct }, away: { off: awayRow?.off, def: awayRow?.def, talent: awayRow?.talent, returningPct: awayRow?.returningPct } });
    return { ...game, challengers, championModel: MODEL_VERSION, researchProvenance: { priorAsOf: prior.meta?.asOf || null, priorSeasonYear: prior.meta?.year || null, priorSource: prior.meta?.source || null, priorVersion: prior.version || prior.meta?.version || null } };
  });
}

export async function attachCbbChallengers(games, env = {}) {
  const season = cbbSeasonYear();
  const [catalog, torvikCatalog, kenpomCatalog] = await Promise.all([
    loadCbbdCatalog(env),
    loadTorvikCbbCatalog(env, { cbbSeason: season }),
    loadKenpomCbbCatalog(env, { cbbSeason: season }),
  ]);
  return {
    games: (games || []).map((game) => {
      if (game.sport && game.sport !== "cbb") return game;
      const home = lookupCbbdRating(catalog, game.home);
      const away = lookupCbbdRating(catalog, game.away);
      const homeTorvik = lookupTorvikRating(torvikCatalog, game.home);
      const awayTorvik = lookupTorvikRating(torvikCatalog, game.away);
      const homeKenpom = lookupKenpomRating(kenpomCatalog, game.home);
      const awayKenpom = lookupKenpomRating(kenpomCatalog, game.away);
      const ratings = {
        homeAdjOe: home?.adjOe,
        homeAdjDe: home?.adjDe,
        homeTempo: home?.tempo,
        awayAdjOe: away?.adjOe,
        awayAdjDe: away?.adjDe,
        awayTempo: away?.tempo,
      };
      const torvikRatings = {
        homeAdjOe: homeTorvik?.adjOe,
        homeAdjDe: homeTorvik?.adjDe,
        homeTempo: homeTorvik?.tempo,
        awayAdjOe: awayTorvik?.adjOe,
        awayAdjDe: awayTorvik?.adjDe,
        awayTempo: awayTorvik?.tempo,
      };
      const kenpomRatings = {
        homeAdjOe: homeKenpom?.adjOe,
        homeAdjDe: homeKenpom?.adjDe,
        homeTempo: homeKenpom?.tempo,
        awayAdjOe: awayKenpom?.adjOe,
        awayAdjDe: awayKenpom?.adjDe,
        awayTempo: awayKenpom?.tempo,
      };
      const four = {
        ...ratings,
        homeEfg: homeTorvik?.efgPct ?? homeKenpom?.efgPct,
        awayEfgDef: awayTorvik?.efgPctD ?? awayKenpom?.efgPctD,
        awayTov: awayTorvik?.tovRate ?? awayKenpom?.tovRate,
        homeTov: homeTorvik?.tovRate ?? homeKenpom?.tovRate,
        homeOrb: homeTorvik?.orbRate ?? homeKenpom?.orbRate,
        awayOrb: awayTorvik?.orbRate ?? awayKenpom?.orbRate,
        homeFtRate: homeTorvik?.ftr ?? homeKenpom?.ftr,
        awayFtRate: awayTorvik?.ftr ?? awayKenpom?.ftr,
      };
      const challengers = projectCbbChallengers(game, { ratings, torvikRatings, kenpomRatings, four });
      return {
        ...game,
        challengers,
        championModel: MODEL_VERSION,
        cbbCatalogCoverage: {
          cbbdMatched: catalog.matched,
          cbbdUnmatched: catalog.unmatched,
          torvikMatched: torvikCatalog.matched || 0,
          torvikUnmatched: torvikCatalog.unmatched || 0,
          kenpomMatched: kenpomCatalog.matched || 0,
          kenpomUnmatched: kenpomCatalog.unmatched || 0,
        },
        researchProvenance: {
          ratingsAsOf: catalog.asOf || null,
          ratingsSeason: catalog.year || null,
          source: "cbbd-adjusted+torvik+kenpom",
          torvikAsOf: torvikCatalog.asOf || null,
          torvikSeason: torvikCatalog.torvikSeason || null,
          torvikAvailable: Boolean(torvikCatalog.ok),
          kenpomAsOf: kenpomCatalog.asOf || null,
          kenpomSeason: kenpomCatalog.kenpomSeason || null,
          kenpomDataThrough: kenpomCatalog.dataThrough || null,
          kenpomAvailable: Boolean(kenpomCatalog.ok),
        },
      };
    }),
    catalog,
    torvikCatalog,
    kenpomCatalog,
  };
}

export function pickChallenger(game, modelId) {
  const c = game?.challengers || {};
  if (modelId && c[modelId]) return { id: modelId, ...c[modelId] };
  return { id: "champion", home: game?.model?.projHome ?? game?.projHomeScore, away: game?.model?.projAway ?? game?.projAwayScore, role: "champion" };
}

export function collegeSysSlice({ cfbd, cbbd, quota, storage, challengers } = {}) {
  return { cfbd: cfbd || { configured: false }, cbbd: cbbd || { configured: false }, quota: quota || null, storage: storage || null, challengers: challengers || Object.keys({}), note: "Shadow college models cannot QUALIFY, LOG, or write strategy tickets." };
}
