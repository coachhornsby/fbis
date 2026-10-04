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
import { loadFbisCbbCatalog, lookupFbisCbbRating, projectFbisCbbGame, FBIS_CBB_MODEL_ID } from "./cbbFbisRatings.js";

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
  const [catalog, torvikCatalog, kenpomCatalog, fbisCatalog] = await Promise.all([
    loadCbbdCatalog(env),
    loadTorvikCbbCatalog(env, { cbbSeason: season }),
    loadKenpomCbbCatalog(env, { cbbSeason: season }),
    loadFbisCbbCatalog(env, { season }),
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
      const homeFbis = lookupFbisCbbRating(fbisCatalog, game.home);
      const awayFbis = lookupFbisCbbRating(fbisCatalog, game.away);
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
      challengers[FBIS_CBB_MODEL_ID] = projectFbisCbbGame(game, homeFbis, awayFbis);
      return {
        ...game,
        challengers,
        championModel: MODEL_VERSION,
        // Retain verified basketball matchup evidence for client analysis.
        // Projection/qualification logic remains in the challenger layer.
        cbbFbisNative: challengers[FBIS_CBB_MODEL_ID],
        cbbFbisRatings: {
          home: homeFbis ? {adjOe:homeFbis.adjOe,adjDe:homeFbis.adjDe,tempo:homeFbis.tempo,net:homeFbis.net,sos:homeFbis.sos,sosO:homeFbis.sosO,sosD:homeFbis.sosD,nonConferenceSos:homeFbis.nonConferenceSos,conference:homeFbis.conference,conferenceStrength:homeFbis.conferenceStrength,reliability:homeFbis.reliability,hca:homeFbis.hca} : null,
          away: awayFbis ? {adjOe:awayFbis.adjOe,adjDe:awayFbis.adjDe,tempo:awayFbis.tempo,net:awayFbis.net,sos:awayFbis.sos,sosO:awayFbis.sosO,sosD:awayFbis.sosD,nonConferenceSos:awayFbis.nonConferenceSos,conference:awayFbis.conference,conferenceStrength:awayFbis.conferenceStrength,reliability:awayFbis.reliability,hca:awayFbis.hca} : null,
          independent: true,
          source: "FBIS prior-completed CBBD game-team box scores",
        },
        cbbMatchupEvidence: {
          home: {
            adjOe: home?.adjOe,
            adjDe: home?.adjDe,
            tempo: home?.tempo,
            efgPct: homeTorvik?.efgPct ?? homeKenpom?.efgPct,
            efgPctD: homeTorvik?.efgPctD ?? homeKenpom?.efgPctD,
            tovRate: homeTorvik?.tovRate ?? homeKenpom?.tovRate,
            tovRateD: homeTorvik?.tovRateD ?? homeKenpom?.tovRateD,
            orbRate: homeTorvik?.orbRate ?? homeKenpom?.orbRate,
            drbRate: homeTorvik?.drbRate ?? homeKenpom?.drbRate,
            ftr: homeTorvik?.ftr ?? homeKenpom?.ftr,
            ftrD: homeTorvik?.ftrD ?? homeKenpom?.ftrD,
            twoPtPct: homeTorvik?.twoPtPct ?? null,
            twoPtPctD: homeTorvik?.twoPtPctD ?? null,
            threePtPct: homeTorvik?.threePtPct ?? homeKenpom?.threePtPct ?? null,
            threePtPctD: homeTorvik?.threePtPctD ?? homeKenpom?.oppThreePtPct ?? null,
            twoPtPct: homeTorvik?.twoPtPct ?? homeKenpom?.twoPtPct ?? null,
            twoPtPctD: homeTorvik?.twoPtPctD ?? homeKenpom?.oppTwoPtPct ?? null,
            possessionLengthOff: homeKenpom?.aplOff ?? null,
            possessionLengthDef: homeKenpom?.aplDef ?? null,
            pointsFromFt: homeKenpom?.pointsFromFt ?? null,
            pointsFrom2: homeKenpom?.pointsFrom2 ?? null,
            pointsFrom3: homeKenpom?.pointsFrom3 ?? null,
            pointsAllowedFt: homeKenpom?.pointsAllowedFt ?? null,
            pointsAllowed2: homeKenpom?.pointsAllowed2 ?? null,
            pointsAllowed3: homeKenpom?.pointsAllowed3 ?? null,
            effectiveHeight: homeKenpom?.effectiveHeight ?? null,
            experience: homeKenpom?.experience ?? null,
            bench: homeKenpom?.bench ?? null,
            continuity: homeKenpom?.continuity ?? null,
            assistRate: homeKenpom?.assistRate ?? null,
            stealRate: homeKenpom?.stealRate ?? null,
            blockPct: homeKenpom?.blockPct ?? null,
            threePtAttemptRate: homeKenpom?.threePtAttemptRate ?? null,
          },
          away: {
            adjOe: away?.adjOe,
            adjDe: away?.adjDe,
            tempo: away?.tempo,
            efgPct: awayTorvik?.efgPct ?? awayKenpom?.efgPct,
            efgPctD: awayTorvik?.efgPctD ?? awayKenpom?.efgPctD,
            tovRate: awayTorvik?.tovRate ?? awayKenpom?.tovRate,
            tovRateD: awayTorvik?.tovRateD ?? awayKenpom?.tovRateD,
            orbRate: awayTorvik?.orbRate ?? awayKenpom?.orbRate,
            drbRate: awayTorvik?.drbRate ?? awayKenpom?.drbRate,
            ftr: awayTorvik?.ftr ?? awayKenpom?.ftr,
            ftrD: awayTorvik?.ftrD ?? awayKenpom?.ftrD,
            twoPtPct: awayTorvik?.twoPtPct ?? null,
            twoPtPctD: awayTorvik?.twoPtPctD ?? null,
            threePtPct: awayTorvik?.threePtPct ?? awayKenpom?.threePtPct ?? null,
            threePtPctD: awayTorvik?.threePtPctD ?? awayKenpom?.oppThreePtPct ?? null,
            twoPtPct: awayTorvik?.twoPtPct ?? awayKenpom?.twoPtPct ?? null,
            twoPtPctD: awayTorvik?.twoPtPctD ?? awayKenpom?.oppTwoPtPct ?? null,
            possessionLengthOff: awayKenpom?.aplOff ?? null,
            possessionLengthDef: awayKenpom?.aplDef ?? null,
            pointsFromFt: awayKenpom?.pointsFromFt ?? null,
            pointsFrom2: awayKenpom?.pointsFrom2 ?? null,
            pointsFrom3: awayKenpom?.pointsFrom3 ?? null,
            pointsAllowedFt: awayKenpom?.pointsAllowedFt ?? null,
            pointsAllowed2: awayKenpom?.pointsAllowed2 ?? null,
            pointsAllowed3: awayKenpom?.pointsAllowed3 ?? null,
            effectiveHeight: awayKenpom?.effectiveHeight ?? null,
            experience: awayKenpom?.experience ?? null,
            bench: awayKenpom?.bench ?? null,
            continuity: awayKenpom?.continuity ?? null,
            assistRate: awayKenpom?.assistRate ?? null,
            stealRate: awayKenpom?.stealRate ?? null,
            blockPct: awayKenpom?.blockPct ?? null,
            threePtAttemptRate: awayKenpom?.threePtAttemptRate ?? null,
          },
          source: "CBBD adjusted ratings + Torvik + KenPom ratings/four-factors/pointdist/height/misc",
        },
        cbbCatalogCoverage: {
          cbbdMatched: catalog.matched,
          cbbdUnmatched: catalog.unmatched,
          torvikMatched: torvikCatalog.matched || 0,
          torvikUnmatched: torvikCatalog.unmatched || 0,
          kenpomMatched: kenpomCatalog.matched || 0,
          kenpomUnmatched: kenpomCatalog.unmatched || 0,
          fbisTeams: Object.keys(fbisCatalog.byTeamId || {}).length,
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
          fbisAsOf: fbisCatalog.asOf || null,
          fbisAvailable: Boolean(fbisCatalog.ok),
          fbisSource: fbisCatalog.source || null,
          fbisIndependent: true,
        },
      };
    }),
    catalog,
    torvikCatalog,
    kenpomCatalog,
    fbisCatalog,
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
