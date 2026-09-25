/**
 * Corrected CBBD ratings baseline.
 * Do NOT copy the old repo total that ignored opposing defenses:
 *   total = avg_tempo * (home_AdjOE + away_AdjOE) / 100
 * Identity-preserving formulas:
 *   expected_home_efficiency = home_adj_oe * away_adj_de / national_avg
 *   expected_away_efficiency = away_adj_oe * home_adj_de / national_avg
 *   expected_possessions = mean(home_tempo, away_tempo) * venueFactor
 *   home_points = expected_home_efficiency * possessions / 100 + HCA/2
 *   away_points = expected_away_efficiency * possessions / 100 - HCA/2
 *   margin = home - away; total = home + away
 *
 * Tempo is an arithmetic mean (validated 50/50). The old 60/40 home split is not assumed.
 * KenPom is optional and never required. Torvik is optional cached-only.
 */

import { CHAMPION_CBB_HCA, NEUTRAL_HFA, COLLEGE_MODELS, failClosedShadow } from "./collegeModels.js";
import { pGreater } from "./metrics.js";
import CBB_REG from "../../data/models/cbb-reg-v1.js";
import { applyRidge, pinnacleImplied, independentEnsemble, attachMc } from "./cfbRatings.js";

export const CBB_NATIONAL_EFF = 104.5;
export const CBB_NATIONAL_TEMPO = 68.0;
export const CBB_LEAGUE_PPG = 72.0;
export const CBB_MARGIN_SIGMA = 11.0;
export const CBB_TOTAL_SIGMA = 11.5;
export const CBB_EFF_MIN = 70;
export const CBB_EFF_MAX = 140;

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function identity(home, away) {
  return { home, away, total: round1(home + away), margin: round1(home - away) };
}

export function cbbHca(game, hca = CHAMPION_CBB_HCA) {
  if (game?.neutralSite || game?.neutral) return NEUTRAL_HFA;
  return hca;
}

/** Arithmetic mean. Neutral and home use the same split until a validated venue factor exists. */
export function expectedPossessions(homeTempo, awayTempo, { venueFactor = 1 } = {}) {
  const ht = num(homeTempo);
  const at = num(awayTempo);
  if (ht == null || at == null) return null;
  return ((ht + at) / 2) * venueFactor;
}

export function expectedEfficiency(off, oppDef, national = CBB_NATIONAL_EFF) {
  const o = num(off);
  const d = num(oppDef);
  const n = num(national);
  if (o == null || d == null || !n) return null;
  return (o * d) / n;
}

export function scaleOk(v) {
  const n = num(v);
  return n != null && n >= CBB_EFF_MIN && n <= CBB_EFF_MAX;
}

/**
 * Identity-preserving CBBD ratings projection.
 * AdjDE is points-allowed per 100 (higher = worse defense), KenPom/Torvik/CBBD convention.
 */
export function cbbRatingsV1(game, ratings = {}, { nationalEff = CBB_NATIONAL_EFF, hca = CHAMPION_CBB_HCA } = {}) {
  const homeOe = num(ratings.homeAdjOe);
  const homeDe = num(ratings.homeAdjDe);
  const awayOe = num(ratings.awayAdjOe);
  const awayDe = num(ratings.awayAdjDe);
  const poss = expectedPossessions(ratings.homeTempo, ratings.awayTempo);
  if ([homeOe, homeDe, awayOe, awayDe, poss].some((v) => v == null) || ![homeOe, homeDe, awayOe, awayDe].every(scaleOk)) {
    return { modelId: "CBB-CBBD-RATINGS-v1", ok: false, reason: "missing-or-wrong-scale", featuresOk: false };
  }
  const homeEff = expectedEfficiency(homeOe, awayDe, nationalEff);
  const awayEff = expectedEfficiency(awayOe, homeDe, nationalEff);
  const h = cbbHca(game, hca);
  const home = round1((homeEff * poss) / 100 + h / 2);
  const away = round1((awayEff * poss) / 100 - h / 2);
  return {
    modelId: "CBB-CBBD-RATINGS-v1",
    ...COLLEGE_MODELS["CBB-CBBD-RATINGS-v1"],
    ok: true,
    ...identity(home, away),
    homeEff: round1(homeEff),
    awayEff: round1(awayEff),
    possessions: round1(poss),
    hca: h,
    nationalEff,
    formula: "eff=AdjOE*oppAdjDE/national; pts=eff*poss/100 ± HCA/2; total=home+away",
    featuresOk: true,
  };
}

export function cbbTorvikRatingsV1(game, ratings = {}, opts = {}) {
  const base = cbbRatingsV1(game, ratings, opts);
  if (!base.ok) {
    return {
      ...base,
      modelId: "CBB-TORVIK-RATINGS-v1",
      ...COLLEGE_MODELS["CBB-TORVIK-RATINGS-v1"],
      source: "torvik",
      available: false,
      featuresOk: false,
    };
  }
  return {
    ...base,
    modelId: "CBB-TORVIK-RATINGS-v1",
    ...COLLEGE_MODELS["CBB-TORVIK-RATINGS-v1"],
    source: "torvik",
    available: true,
    featuresOk: true,
  };
}

export function cbbKenPomRatingsV1(game, ratings = {}, opts = {}) {
  const base = cbbRatingsV1(game, ratings, opts);
  if (!base.ok) {
    return {
      ...base,
      modelId: "CBB-KENPOM-SHADOW",
      ...COLLEGE_MODELS["CBB-KENPOM-SHADOW"],
      source: "kenpom",
      available: false,
      featuresOk: false,
    };
  }
  return {
    ...base,
    modelId: "CBB-KENPOM-SHADOW",
    ...COLLEGE_MODELS["CBB-KENPOM-SHADOW"],
    source: "kenpom",
    available: true,
    featuresOk: true,
  };
}

/** The rejected old-repo total — kept only so tests prove we do not use it. */
export function rejectedOldCbbTotal(homeOe, awayOe, homeTempo, awayTempo) {
  const avgTempo = (Number(homeTempo) + Number(awayTempo)) / 2;
  return avgTempo * (Number(homeOe) + Number(awayOe)) / 100;
}

export function cbbLeagueBaseline(game, { hca = CHAMPION_CBB_HCA } = {}) {
  const h = cbbHca(game, hca);
  const home = round1(CBB_LEAGUE_PPG + h / 2);
  const away = round1(CBB_LEAGUE_PPG - h / 2);
  return {
    modelId: "CBB-LEAGUE-BASELINE",
    ...COLLEGE_MODELS["CBB-LEAGUE-BASELINE"],
    ok: true,
    ...identity(home, away),
    hca: h,
    featuresOk: true,
  };
}

export function cbbMatchupV1(game, four = {}) {
  const efgGap = (num(four.homeEfg) || 0) - (num(four.awayEfgDef) || 0);
  const toGap = (num(four.awayTov) || 0) - (num(four.homeTov) || 0);
  const rebGap = (num(four.homeOrb) || 0) - (num(four.awayOrb) || 0);
  const ftGap = (num(four.homeFtRate) || 0) - (num(four.awayFtRate) || 0);
  const ratings = cbbRatingsV1(game, four);
  if (!ratings.ok) {
    return { modelId: "CBB-MATCHUP-v1", ok: false, reason: ratings.reason, featuresOk: false };
  }
  const adj = 0.15 * efgGap * 100 + 0.08 * toGap + 0.05 * rebGap + 0.04 * ftGap;
  const home = round1(ratings.home + adj / 2);
  const away = round1(ratings.away - adj / 2);
  return {
    modelId: "CBB-MATCHUP-v1",
    ...COLLEGE_MODELS["CBB-MATCHUP-v1"],
    ok: true,
    ...identity(home, away),
    matchupAdj: round1(adj),
    featuresOk: true,
  };
}

export function cbbRegV1(game, features = {}, artifact = CBB_REG) {
  if (!artifact?.coefficients) {
    return { modelId: "CBB-REG-v1", ok: false, reason: "unknown-artifact", featuresOk: false };
  }
  const required = artifact.requiredFeatures || ["home_adj_oe", "home_adj_de", "away_adj_oe", "away_adj_de", "possessions"];
  if (required.some((k) => num(features[k]) == null)) {
    return { modelId: "CBB-REG-v1", ok: false, reason: "missing-features", featuresOk: false };
  }
  const home = round1(applyRidge(features, { coefficients: artifact.coefficients.home, featureNames: artifact.featureNames }));
  const away = round1(applyRidge(features, { coefficients: artifact.coefficients.away, featureNames: artifact.featureNames }));
  return {
    modelId: "CBB-REG-v1",
    ...COLLEGE_MODELS["CBB-REG-v1"],
    ok: true,
    ...identity(home, away),
    artifactId: artifact.id,
    trainingCutoff: artifact.trainingCutoff,
    featuresOk: true,
  };
}

export function cbbMarketShrunk(independent, pin, { k = 8 } = {}) {
  if (!independent?.ok || independent.home == null || !pin?.ok) {
    return { modelId: "CBB-MARKET-SHRUNK-v1", ok: false, reason: "need-both-independent-and-market", marketInformed: true, independent: false };
  }
  const w = k / (k + 1);
  const home = round1(w * independent.home + (1 - w) * pin.home);
  const away = round1(w * independent.away + (1 - w) * pin.away);
  return {
    modelId: "CBB-MARKET-SHRUNK-v1",
    ...COLLEGE_MODELS["CBB-MARKET-SHRUNK-v1"],
    ok: true,
    ...identity(home, away),
    marketInformed: true,
    independent: false,
    note: "Labeled market-informed. Do not treat (this − Pinnacle) as independent edge.",
    featuresOk: true,
  };
}

export function torvikUnavailable() {
  return {
    modelId: "CBB-TORVIK-RATINGS-v1",
    ...COLLEGE_MODELS["CBB-TORVIK-RATINGS-v1"],
    ok: false,
    reason: "torvik-unauthorized-or-unavailable",
    available: false,
    featuresOk: false,
  };
}

export function kenpomAbsent() {
  return {
    modelId: "CBB-KENPOM-SHADOW",
    ...COLLEGE_MODELS["CBB-KENPOM-SHADOW"],
    ok: false,
    reason: "kenpom-not-required-and-not-loaded",
    available: false,
    featuresOk: false,
  };
}

export function projectCbbChallengers(game, ctx = {}) {
  const identityOk = Boolean(game?.home?.canonicalId && game?.away?.canonicalId);
  const ratingsIn = ctx.ratings || {};
  const league = cbbLeagueBaseline(game);
  const ratings = cbbRatingsV1(game, ratingsIn);
  const torvik = ctx.torvik?.modelId
    ? ctx.torvik
    : cbbTorvikRatingsV1(game, ctx.torvikRatings || {});
  const kenpom = ctx.kenpom?.modelId
    ? ctx.kenpom
    : cbbKenPomRatingsV1(game, ctx.kenpomRatings || {});
  const matchup = cbbMatchupV1(game, { ...ratingsIn, ...ctx.four });
  const poss = expectedPossessions(ratingsIn.homeTempo, ratingsIn.awayTempo) || CBB_NATIONAL_TEMPO;
  const reg = cbbRegV1(game, {
    home_adj_oe: ratingsIn.homeAdjOe,
    home_adj_de: ratingsIn.homeAdjDe,
    away_adj_oe: ratingsIn.awayAdjOe,
    away_adj_de: ratingsIn.awayAdjDe,
    possessions: poss,
    hca: cbbHca(game),
  });
  const pin = pinnacleImplied(game);
  const pinModel = {
    modelId: "CBB-PINNACLE-IMPLIED",
    ...COLLEGE_MODELS["CBB-PINNACLE-IMPLIED"],
    ...pin,
    independent: false,
  };
  const ensemble = independentEnsemble(
    [league, ratings.ok ? ratings : null, torvik.ok ? torvik : null, kenpom.ok ? kenpom : null, matchup.ok ? matchup : null, reg.ok ? reg : null],
    "CBB-ENSEMBLE-v1"
  );
  const shrunk = cbbMarketShrunk(ratings.ok ? ratings : league, pin);
  const models = {
    "CBB-LEAGUE-BASELINE": attachMc(league, { sigmaMargin: CBB_MARGIN_SIGMA, sigmaTotal: CBB_TOTAL_SIGMA }),
    "CBB-CBBD-RATINGS-v1": ratings.ok ? attachMc(ratings, { sigmaMargin: CBB_MARGIN_SIGMA, sigmaTotal: CBB_TOTAL_SIGMA }) : ratings,
    "CBB-TORVIK-RATINGS-v1": torvik.ok ? attachMc(torvik, { sigmaMargin: CBB_MARGIN_SIGMA, sigmaTotal: CBB_TOTAL_SIGMA }) : torvik,
    "CBB-MATCHUP-v1": matchup.ok ? attachMc(matchup, { sigmaMargin: CBB_MARGIN_SIGMA, sigmaTotal: CBB_TOTAL_SIGMA }) : matchup,
    "CBB-REG-v1": reg.ok ? attachMc(reg, { sigmaMargin: CBB_MARGIN_SIGMA, sigmaTotal: CBB_TOTAL_SIGMA }) : reg,
    "CBB-ENSEMBLE-v1": ensemble.ok ? attachMc(ensemble, { sigmaMargin: CBB_MARGIN_SIGMA, sigmaTotal: CBB_TOTAL_SIGMA }) : ensemble,
    "CBB-MARKET-SHRUNK-v1": shrunk,
    "CBB-PINNACLE-IMPLIED": pinModel,
    "CBB-KENPOM-SHADOW": kenpom.ok ? attachMc(kenpom, { sigmaMargin: CBB_MARGIN_SIGMA, sigmaTotal: CBB_TOTAL_SIGMA }) : kenpom,
  };
  for (const [id, proj] of Object.entries(models)) {
    models[id] = {
      ...proj,
      ...failClosedShadow({
        identityOk,
        projectionState: ratings.ok ? "COMPLETE" : "PARTIAL",
        featuresOk: proj.featuresOk !== false,
        artifactKnown: id !== "CBB-REG-v1" || Boolean(CBB_REG?.coefficients),
        cutoffOk: true,
        marketPaired: pin.ok,
        pricePresent: pin.ok,
        dataQuality: ratings.ok ? 0.7 : 0.2,
        pinnacleOnly: id === "CBB-PINNACLE-IMPLIED",
        modelId: id,
      }),
    };
  }
  return models;
}

export function lookupCbbdRating(catalog, team) {
  if (!catalog) return null;
  const id = team?.canonicalId || team?.espnId;
  return (
    catalog.byCanonicalId?.[id] ||
    catalog.byEspnId?.[String(team?.espnId || "")] ||
    catalog.bySchool?.[String(team?.school || team?.name || "").toLowerCase()] ||
    null
  );
}
