/**
 * Attach shadow college challengers to a slate game. Champion scores stay unchanged.
 */

import { loadCfbPrior, lookupPrior } from "./cfbd.js";
import { cbbdGet, cbbSeasonYear } from "./collegeApi.js";
import { projectCfbChallengers } from "./cfbRatings.js";
import { projectCbbChallengers, lookupCbbdRating } from "./cbbRatings.js";
import { readCache, writeCache } from "./cache.js";
import { mapSourceTeam } from "./collegeIdentity.js";

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
    if (!Number.isFinite(off) || !Number.isFinite(defn)) {
      unmatched += 1;
      continue;
    }
    const rec = {
      adjOe: off,
      adjDe: defn,
      tempo: Number.isFinite(tempo) ? tempo : 68,
      canonicalId: mapped.ok ? mapped.canonicalId : null,
      espnId: mapped.ok ? mapped.espnId : null,
      school: mapped.ok ? mapped.school : row.team || row.school,
    };
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
    const challengers = projectCfbChallengers(game, {
      home: { off: homeRow?.off, def: homeRow?.def, talent: homeRow?.talent, returningPct: homeRow?.returningPct },
      away: { off: awayRow?.off, def: awayRow?.def, talent: awayRow?.talent, returningPct: awayRow?.returningPct },
    });
    const enriched = game.cfb?.challengers?.enrichedV1;
    if (enriched) {
      challengers["CFB-CFBD-ENRICHED-v1"] = {
        ...enriched,
        modelId: "CFB-CFBD-ENRICHED-v1",
        ok: true,
        role: "shadow",
        canQualify: false,
      };
    }
    return { ...game, challengers, championModel: "FBIS-v1.3" };
  });
}

export async function attachCbbChallengers(games, env = {}) {
  const catalog = await loadCbbdCatalog(env);
  return {
    games: (games || []).map((game) => {
      if (game.sport && game.sport !== "cbb") return game;
      const home = lookupCbbdRating(catalog, game.home);
      const away = lookupCbbdRating(catalog, game.away);
      const challengers = projectCbbChallengers(game, {
        ratings: {
          homeAdjOe: home?.adjOe,
          homeAdjDe: home?.adjDe,
          homeTempo: home?.tempo,
          awayAdjOe: away?.adjOe,
          awayAdjDe: away?.adjDe,
          awayTempo: away?.tempo,
        },
      });
      return { ...game, challengers, championModel: "FBIS-v1.3", cbbCatalogCoverage: { matched: catalog.matched, unmatched: catalog.unmatched } };
    }),
    catalog,
  };
}

export function pickChallenger(game, modelId) {
  const c = game?.challengers || {};
  if (modelId && c[modelId]) return { id: modelId, ...c[modelId] };
  return { id: "champion", home: game?.model?.projHome ?? game?.projHomeScore, away: game?.model?.projAway ?? game?.projAwayScore, role: "champion" };
}

export function collegeSysSlice({ cfbd, cbbd, quota, storage, challengers } = {}) {
  return {
    cfbd: cfbd || { configured: false },
    cbbd: cbbd || { configured: false },
    quota: quota || null,
    storage: storage || null,
    challengers: challengers || Object.keys({}),
    note: "Shadow college models cannot QUALIFY, LOG, or write strategy tickets.",
  };
}
