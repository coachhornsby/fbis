/**
 * CFB home-field advantage: champion vs shadow challengers.
 *
 * Concepts stay separate and are never added together in a production projection:
 *   1. Champion HFA — 2.5 true home, 0 confirmed neutral. Production.
 *   2. Score-based challenger — opponent-adjusted home-margin residual. Shadow.
 *   3. Market-residual challenger — ATS residual vs timestamped closes. Shadow.
 *   4. Blue Chip external benchmark — dated third-party research. Shadow only.
 *
 * Do not invent Action Network ratings.
 * Do not claim to reproduce Blue Chip smoothing.
 * Do not promote challengers from the 7–0 CONVICTION result.
 */

import { namesMatch, normName } from "./match.js";
import { mae, rmse, bias, pCoverHome, pGreater } from "./metrics.js";
import { brierScore, logLoss } from "./pricing.js";
import { BLUECHIP_2026_ROWS, BLUECHIP_META } from "./hfaBlueChip.js";

export const CHAMPION_HFA = 2.5;
export const NEUTRAL_HFA = 0;
export const HFA_SHRINKAGE_K = 40;
export const HFA_MIN_HOME = 15;
export const HFA_MIN_ROAD = 15;
export const HFA_MIN_SEASONS = 4;
export const HFA_RAW_FLOOR = -1;
export const HFA_RAW_CEIL = 7;
export const HFA_EXTREME_DELTA = 3;
export const SCORE_HFA_VERSION = "score-oppadj-v1";
export const MARKET_HFA_VERSION = "market-resid-v1";
export const CLV_IRRELEVANT = true;

/**
 * Promotion rules are frozen before any OOS numbers are inspected.
 * Challengers stay in shadow unless every criterion is genuinely met.
 */
export const HFA_PROMOTION_CRITERIA = {
  definedBeforeResults: true,
  minOosN: 400,
  minSeasonsImproved: 3,
  minMaeImprovement: 0.15,
  maxBrierDegradation: 0.02,
  maxImprovementFromTopTeams: 0.15,
  minYearToYearCorrelation: 0.25,
  requireNoLeakage: true,
  requireReproducible: true,
  requireRollback: true,
  keepShadowIf: [
    "improvement negligible",
    "year-to-year stability weak",
    "results depend heavily on shrinkage",
    "closing-line coverage incomplete",
    "team mappings unreliable",
    "venue classification incomplete",
  ],
};

export const HFA_UNAVAILABLE = {
  available: false,
  reason: "insufficient-data",
  raw: null,
  shrunken: null,
  uncertainty: null,
  sampleSize: 0,
  homeN: 0,
  roadN: 0,
  seasons: 0,
  nEff: 0,
  reliability: 0,
  flags: ["unavailable"],
  methodVersion: null,
};

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function mean(xs) {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}

export function harmonicMean(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!(x > 0) || !(y > 0)) return 0;
  return (2 * x * y) / (x + y);
}

export function reliabilityFromSamples(homeN, roadN, k = HFA_SHRINKAGE_K) {
  const nEff = harmonicMean(homeN, roadN);
  return { nEff, reliability: nEff / (nEff + k) };
}

export function shrinkTowardChampion(raw, reliability, champion = CHAMPION_HFA) {
  if (raw == null || !Number.isFinite(Number(raw))) return champion;
  const r = Math.max(0, Math.min(1, Number(reliability) || 0));
  return champion + r * (Number(raw) - champion);
}

export function capAndFlagRaw(raw) {
  const flags = [];
  if (raw == null || !Number.isFinite(Number(raw))) return { raw: CHAMPION_HFA, flags: ["missing_raw"] };
  let v = Number(raw);
  if (Math.abs(v - CHAMPION_HFA) > HFA_EXTREME_DELTA) flags.push("extreme");
  if (v < HFA_RAW_FLOOR) {
    v = HFA_RAW_FLOOR;
    flags.push("capped");
  }
  if (v > HFA_RAW_CEIL) {
    v = HFA_RAW_CEIL;
    flags.push("capped");
  }
  return { raw: round2(v), flags };
}

export function eligibleHfaSample({ homeN = 0, roadN = 0, seasons = 0 } = {}) {
  return homeN >= HFA_MIN_HOME && roadN >= HFA_MIN_ROAD && seasons >= HFA_MIN_SEASONS;
}

export function championHfaForGame(game = {}) {
  const venue = classifyVenue(game);
  if (venue.neutral) return { hfa: NEUTRAL_HFA, ...venue };
  if (venue.uncertain) {
    return { hfa: CHAMPION_HFA, ...venue, fallback: "champion-2.5" };
  }
  return { hfa: CHAMPION_HFA, ...venue };
}

export function classifyVenue(game = {}) {
  const venue = String(game.venue || game.park || "");
  const notes = Array.isArray(game.notes) ? game.notes.join(" ") : String(game.notes || "");
  const blob = `${venue} ${notes} ${game.status?.detail || ""}`;
  const flaggedNeutral = Boolean(game.neutralSite);
  const bowlOrCcg = /\b(bowl|conference championship|national championship|playoff|ccg)\b/i.test(blob);
  const international = /\b(london|dublin|munich|sydney|melbourne|tokyo|mexico city|berlin|toronto)\b/i.test(blob);
  const designatedHome = Boolean(game.home?.name || game.homeName);
  const trueHomeUnknown = !flaggedNeutral && (!venue || /tbd|undecided|neutral/i.test(venue) || international);
  const awayOwnsVenue =
    !flaggedNeutral &&
    venue &&
    game.away?.name &&
    namesMatch(venue, game.away.name) &&
    game.home?.name &&
    !namesMatch(venue, game.home.name);
  const designatedNotTrueHome = awayOwnsVenue || (bowlOrCcg && !flaggedNeutral && international);
  const neutral = flaggedNeutral || (bowlOrCcg && flaggedNeutral) || awayOwnsVenue;
  const uncertain = !neutral && (trueHomeUnknown || designatedNotTrueHome || international);
  return {
    venue,
    designatedHome,
    trueHome: Boolean(!neutral && venue && !uncertain),
    designatedNotTrueHome: Boolean(designatedNotTrueHome),
    neutral: Boolean(neutral),
    bowlOrCcg: Boolean(bowlOrCcg),
    international: Boolean(international),
    uncertain: Boolean(uncertain),
    flags: [
      flaggedNeutral || neutral ? "neutral_site" : null,
      bowlOrCcg ? "bowl_or_ccg" : null,
      international ? "international_venue" : null,
      uncertain ? "venue_uncertain" : null,
      designatedNotTrueHome ? "designated_home_not_true_home" : null,
    ].filter(Boolean),
  };
}

/** Closing spread: home negative means home favored. Market-expected home margin = -spread. */
export function marketExpectedHomeMargin(homeSpread) {
  const n = Number(homeSpread);
  if (!Number.isFinite(n)) return null;
  return -n;
}

export function marketResidual(homeScore, awayScore, homeSpread) {
  const expected = marketExpectedHomeMargin(homeSpread);
  if (expected == null) return null;
  const actual = Number(homeScore) - Number(awayScore);
  if (!Number.isFinite(actual)) return null;
  return actual - expected;
}

/**
 * Blue Chip-style raw from home vs road residuals.
 * raw = 2.5 + (meanHomeResidual − meanRoadResidual) / 2
 * Road residual is the team's residual when it is the visitor, from the team's scoring perspective.
 */
export function rawHfaFromResiduals(homeResiduals, roadResiduals, champion = CHAMPION_HFA) {
  const h = mean(homeResiduals);
  const r = mean(roadResiduals);
  if (h == null && r == null) return null;
  if (h == null) return round2(champion - (r || 0) / 2);
  if (r == null) return round2(champion + h / 2);
  return round2(champion + (h - r) / 2);
}

export function smoothHfaFromRaw(raw, homeN, roadN, seasons) {
  const eligible = eligibleHfaSample({ homeN, roadN, seasons });
  const { nEff, reliability } = reliabilityFromSamples(eligible ? homeN : Math.min(homeN, 5), eligible ? roadN : Math.min(roadN, 5));
  const capped = capAndFlagRaw(raw);
  const usedReliability = eligible ? reliability : 0;
  const shrunken = eligible ? round2(shrinkTowardChampion(capped.raw, usedReliability)) : CHAMPION_HFA;
  const flags = [...capped.flags];
  if (!eligible) flags.push("small_sample");
  if (seasons < HFA_MIN_SEASONS) flags.push("few_seasons");
  return {
    available: true,
    raw: capped.raw,
    shrunken,
    uncertainty: round2(1 - usedReliability),
    sampleSize: homeN + roadN,
    homeN,
    roadN,
    seasons,
    nEff: round2(nEff),
    reliability: round2(usedReliability),
    flags,
    eligible,
  };
}

export function iterativeSrs(games, { hfa = CHAMPION_HFA, iters = 50 } = {}) {
  const keys = [...new Set((games || []).flatMap((g) => [g.homeTeamKey, g.awayTeamKey]).filter(Boolean))];
  const r = Object.fromEntries(keys.map((k) => [k, 0]));
  if (!keys.length) return r;
  for (let i = 0; i < iters; i += 1) {
    const acc = Object.fromEntries(keys.map((k) => [k, []]));
    for (const g of games) {
      const margin = Number(g.homeScore) - Number(g.awayScore);
      if (!Number.isFinite(margin)) continue;
      const target = margin - (g.neutral ? 0 : hfa);
      acc[g.homeTeamKey]?.push(target + r[g.awayTeamKey]);
      acc[g.awayTeamKey]?.push(-target + r[g.homeTeamKey]);
    }
    let sum = 0;
    for (const k of keys) {
      const xs = acc[k];
      r[k] = xs.length ? mean(xs) : 0;
      sum += r[k];
    }
    const mu = sum / keys.length;
    for (const k of keys) r[k] -= mu;
  }
  return r;
}

export function qualifyingGame(g, { asOfSeason, requireClose = false } = {}) {
  if (!g) return false;
  if (g.neutral || g.neutralSite) return false;
  if (g.fbsVsFbs === false) return false;
  if (g.homeScore == null || g.awayScore == null) return false;
  if (asOfSeason != null && Number(g.season) > Number(asOfSeason)) return false;
  if (requireClose && (g.closingSpread == null || !g.closingAt)) return false;
  return true;
}

/**
 * Score-based challenger. Opponent-adjusted via iterative SRS, then home/road residuals.
 * A game in season Y cannot train the ratings used to predict season Y when asOfSeason = Y-1.
 */
export function fitScoreBasedHfa(games, { asOfSeason, predictSeason } = {}) {
  const trainSeason = asOfSeason ?? (predictSeason != null ? Number(predictSeason) - 1 : null);
  const train = (games || []).filter((g) => qualifyingGame(g, { asOfSeason: trainSeason }));
  if (train.length < 80) {
    return { available: false, reason: "insufficient-data", methodVersion: SCORE_HFA_VERSION, gamesUsed: train.length, asOfSeason: trainSeason, byTeam: {} };
  }
  const ratings = iterativeSrs(train, { hfa: CHAMPION_HFA });
  const homeRes = {};
  const roadRes = {};
  const seasons = {};
  for (const g of train) {
    const rh = ratings[g.homeTeamKey] ?? 0;
    const ra = ratings[g.awayTeamKey] ?? 0;
    const actual = Number(g.homeScore) - Number(g.awayScore);
    const predicted = rh - ra + CHAMPION_HFA;
    const resid = actual - predicted;
    (homeRes[g.homeTeamKey] ||= []).push(resid);
    (roadRes[g.awayTeamKey] ||= []).push(-resid);
    (seasons[g.homeTeamKey] ||= new Set()).add(g.season);
    (seasons[g.awayTeamKey] ||= new Set()).add(g.season);
  }
  const byTeam = {};
  const keys = new Set([...Object.keys(homeRes), ...Object.keys(roadRes)]);
  for (const k of keys) {
    const raw = rawHfaFromResiduals(homeRes[k] || [], roadRes[k] || []);
    const packed = smoothHfaFromRaw(raw, (homeRes[k] || []).length, (roadRes[k] || []).length, (seasons[k] || new Set()).size);
    byTeam[k] = {
      ...packed,
      methodVersion: SCORE_HFA_VERSION,
      nationalBaseline: CHAMPION_HFA,
      recency: "expanding-through-asOfSeason",
    };
  }
  return {
    available: true,
    methodVersion: SCORE_HFA_VERSION,
    asOfSeason: trainSeason,
    gamesUsed: train.length,
    nationalBaseline: CHAMPION_HFA,
    shrinkageK: HFA_SHRINKAGE_K,
    byTeam,
  };
}

/**
 * Market-residual challenger. Requires timestamped historical closing spreads.
 * Do not backfill with later markets. Closing-line source must be present.
 */
export function fitMarketResidualHfa(games, { asOfSeason, predictSeason } = {}) {
  const trainSeason = asOfSeason ?? (predictSeason != null ? Number(predictSeason) - 1 : null);
  const train = (games || []).filter((g) => qualifyingGame(g, { asOfSeason: trainSeason, requireClose: true }));
  if (!train.length) {
    return {
      available: false,
      reason: "no-timestamped-closes",
      methodVersion: MARKET_HFA_VERSION,
      gamesUsed: 0,
      asOfSeason: trainSeason,
      byTeam: {},
      note: "Market-residual HFA stays unavailable without reliable historical closing lines and timestamps. Later markets are not backfilled.",
    };
  }
  const homeRes = {};
  const roadRes = {};
  const seasons = {};
  for (const g of train) {
    const resid = marketResidual(g.homeScore, g.awayScore, g.closingSpread);
    if (resid == null) continue;
    (homeRes[g.homeTeamKey] ||= []).push(resid);
    (roadRes[g.awayTeamKey] ||= []).push(-resid);
    (seasons[g.homeTeamKey] ||= new Set()).add(g.season);
    (seasons[g.awayTeamKey] ||= new Set()).add(g.season);
  }
  const byTeam = {};
  for (const k of new Set([...Object.keys(homeRes), ...Object.keys(roadRes)])) {
    const raw = rawHfaFromResiduals(homeRes[k] || [], roadRes[k] || []);
    const packed = smoothHfaFromRaw(raw, (homeRes[k] || []).length, (roadRes[k] || []).length, (seasons[k] || new Set()).size);
    byTeam[k] = {
      ...packed,
      methodVersion: MARKET_HFA_VERSION,
      nationalBaseline: CHAMPION_HFA,
      closingSource: "Pinnacle-or-recorded-close",
      notStadiumEffect: true,
    };
  }
  return {
    available: true,
    methodVersion: MARKET_HFA_VERSION,
    asOfSeason: trainSeason,
    gamesUsed: train.length,
    nationalBaseline: CHAMPION_HFA,
    shrinkageK: HFA_SHRINKAGE_K,
    byTeam,
    note: "Residual versus closing spread is not a direct stadium effect; the close already prices market HFA.",
  };
}

function blueChipKey(name) {
  return normName(name).replace(/\s+/g, "-");
}

export const BLUECHIP_INDEX = BLUECHIP_2026_ROWS.map(([name, conference, raw, smooth]) => ({
  name,
  conference,
  rawHfa: raw,
  smoothHfa: smooth,
  teamKey: blueChipKey(name),
  ...BLUECHIP_META,
}));

export function lookupBlueChip(team) {
  if (!team) return null;
  const name = team.name || team.displayName || "";
  const abbr = team.abbr || "";
  const hit =
    BLUECHIP_INDEX.find((row) => namesMatch(row.name, name)) ||
    BLUECHIP_INDEX.find((row) => abbr && namesMatch(row.name, abbr)) ||
    null;
  return hit || null;
}

export function blueChipShadow(team) {
  const row = lookupBlueChip(team);
  if (!row) {
    return {
      available: false,
      matched: false,
      rawHfa: null,
      smoothHfa: CHAMPION_HFA,
      fallback: CHAMPION_HFA,
      ratingYear: BLUECHIP_META.ratingYear,
      source: BLUECHIP_META.source,
      benchmarkOnly: true,
      flags: ["unmatched", "fallback-2.5"],
    };
  }
  return {
    available: true,
    matched: true,
    team: row.name,
    conference: row.conference,
    rawHfa: row.rawHfa,
    smoothHfa: row.smoothHfa,
    ratingYear: row.ratingYear,
    source: row.source,
    suppliedDate: row.suppliedDate,
    methodologySummary: row.methodologySummary,
    limitations: row.limitations,
    smoothingReproduced: false,
    benchmarkOnly: true,
    flags: ["benchmark-only"],
  };
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function challengerScores(hfa, ctx) {
  if (hfa == null || !Number.isFinite(Number(hfa))) return null;
  const home = ctx?.homeEst;
  const away = ctx?.awayEst;
  if (!home || !away || home.off == null || away.off == null) return null;
  const hs = round1((Number(home.off) + Number(away.def)) / 2 + Number(hfa) / 2);
  const as = round1((Number(away.off) + Number(home.def)) / 2 - Number(hfa) / 2);
  return { home: hs, away: as, total: hs + as, margin: hs - as };
}

function probsFromScores(scores, sigma, spread, total) {
  if (!scores) return { pHome: null, pSpreadHome: null, pOver: null };
  const pOver = scores.total != null && total != null && sigma?.total != null ? pGreater(scores.total, total, sigma.total) : null;
  return {
    pHome: sigma?.margin != null ? pGreater(scores.margin, 0, sigma.margin) : null,
    pSpreadHome: spread != null && sigma?.margin != null ? pCoverHome(scores.margin, spread, sigma.margin) : null,
    pOver,
  };
}

export function lookupTeamRating(byTeam, team) {
  if (!byTeam || !team) return null;
  const key = team.key || team.teamKey || team.espnId || team.abbr || team.name;
  return (
    byTeam[key] ||
    byTeam[`id:${team.espnId}`] ||
    byTeam[`abbr:${String(team.abbr || "").toUpperCase()}`] ||
    byTeam[normName(team.name)] ||
    null
  );
}

/**
 * Shadow payload frozen with a CFB snapshot. Champion projection is unchanged.
 * Missing challengers stay unavailable rather than inventing a number.
 */
export function buildShadowHfa(game, { scoreFit, marketFit, homeEst, awayEst } = {}) {
  const champ = championHfaForGame(game);
  const scoreRow = lookupTeamRating(scoreFit?.byTeam, game.home);
  const marketRow = lookupTeamRating(marketFit?.byTeam, game.home);
  const blue = blueChipShadow(game.home);
  const sigma = {
    margin: game.cfb?.sigmaMargin,
    total: game.cfb?.sigmaTotal,
  };
  const ctx = { homeEst: homeEst || game.cfb?.homeEst, awayEst: awayEst || game.cfb?.awayEst };
  const scoreHfa = champ.neutral ? NEUTRAL_HFA : scoreRow?.eligible ? scoreRow.shrunken : null;
  const marketHfa = champ.neutral ? NEUTRAL_HFA : marketRow?.eligible ? marketRow.shrunken : null;
  const scoreProj = scoreHfa != null ? challengerScores(scoreHfa, ctx) : null;
  const marketProj = marketHfa != null ? challengerScores(marketHfa, ctx) : null;
  const champProj = challengerScores(champ.hfa, ctx);
  const spread = game.odds?.spread ?? game.pinSpread;
  const total = game.odds?.total ?? game.pinTotal;
  return {
    mode: "shadow",
    productionUses: "champion",
    doubleCount: false,
    champion: {
      hfa: champ.hfa,
      modelVersion: "FBIS-v1.3",
      projected: champProj,
      probabilities: probsFromScores(champProj, sigma, spread, total),
      venue: champ,
    },
    scoreBased: {
      available: Boolean(scoreFit?.available && scoreRow?.available && scoreRow.eligible && !champ.neutral),
      raw: scoreRow?.raw ?? null,
      shrunken: scoreRow?.shrunken ?? null,
      uncertainty: scoreRow?.uncertainty ?? null,
      sampleSize: scoreRow?.sampleSize ?? 0,
      homeN: scoreRow?.homeN ?? 0,
      roadN: scoreRow?.roadN ?? 0,
      seasons: scoreRow?.seasons ?? 0,
      methodVersion: SCORE_HFA_VERSION,
      projected: scoreProj,
      probabilities: probsFromScores(scoreProj, sigma, spread, total),
      flags: [
        ...(scoreRow?.flags || []),
        scoreFit?.available ? null : "score-hfa-unavailable",
        champ.neutral ? "neutral-zero" : null,
      ].filter(Boolean),
      reason: scoreFit?.available ? scoreRow?.flags?.includes("small_sample") ? "small-sample-2.5" : null : scoreFit?.reason || "insufficient-data",
    },
    marketResidual: {
      available: Boolean(marketFit?.available && marketRow?.available && marketRow.eligible && !champ.neutral),
      raw: marketRow?.raw ?? null,
      smooth: marketRow?.shrunken ?? null,
      homeN: marketRow?.homeN ?? 0,
      roadN: marketRow?.roadN ?? 0,
      closingLineSource: marketRow?.closingSource || null,
      methodVersion: MARKET_HFA_VERSION,
      projected: marketProj,
      probabilities: probsFromScores(marketProj, sigma, spread, total),
      flags: [
        ...(marketRow?.flags || []),
        marketFit?.available ? null : "market-hfa-unavailable",
        champ.neutral ? "neutral-zero" : null,
      ].filter(Boolean),
      reason: marketFit?.note || marketFit?.reason || "no-timestamped-closes",
      notStadiumEffect: true,
    },
    externalBenchmark: {
      ...blue,
      flags: [...(blue.flags || []), champ.neutral ? "neutral-ignored" : null].filter(Boolean),
    },
  };
}

export function promotionBlocked(report = {}) {
  const reasons = [];
  if ((report.oosN || 0) < HFA_PROMOTION_CRITERIA.minOosN) reasons.push("oos-n");
  if ((report.seasonsImproved || 0) < HFA_PROMOTION_CRITERIA.minSeasonsImproved) reasons.push("seasons");
  if ((report.maeImprovement || 0) < HFA_PROMOTION_CRITERIA.minMaeImprovement) reasons.push("mae");
  if ((report.yearToYearCorr || 0) < HFA_PROMOTION_CRITERIA.minYearToYearCorrelation) reasons.push("stability");
  if (report.leakage) reasons.push("leakage");
  return { promote: reasons.length === 0 && Boolean(report.ready), reasons, mode: "shadow" };
}

export function evaluateHfaOos(games, { predictSeason, scoreFit, marketFit } = {}) {
  const year = Number(predictSeason);
  const rows = (games || []).filter((g) => Number(g.season) === year && !g.neutral);
  const compare = (getHfa) => {
    const xs = [];
    for (const g of rows) {
      const hfa = getHfa(g);
      if (hfa == null) continue;
      const actual = Number(g.homeScore) - Number(g.awayScore);
      const pred = (g.homeRating || 0) - (g.awayRating || 0) + hfa;
      const err = pred - actual;
      const homeWin = actual > 0;
      const p = pCoverHome(pred, 0, 15.5);
      xs.push({ err, abs: Math.abs(err), homeWin, p, pred, actual });
    }
    const decided = xs.filter((r) => r.actual !== 0);
    return {
      n: xs.length,
      mae: xs.length ? mae(xs.map((r) => r.err)) : null,
      rmse: xs.length ? rmse(xs.map((r) => r.err)) : null,
      bias: xs.length ? bias(xs.map((r) => r.err)) : null,
      winnerHit: decided.length ? decided.filter((r) => (r.pred > 0) === r.homeWin).length / decided.length : null,
      brier: decided.length ? decided.reduce((s, r) => s + brierScore(r.p ?? 0.5, r.homeWin ? 1 : 0), 0) / decided.length : null,
      logLoss: decided.length ? decided.reduce((s, r) => s + logLoss(Math.min(0.999, Math.max(0.001, r.p ?? 0.5)), r.homeWin ? 1 : 0), 0) / decided.length : null,
    };
  };
  return {
    predictSeason: year,
    n: rows.length,
    champion: compare(() => CHAMPION_HFA),
    scoreBased: compare((g) => lookupTeamRating(scoreFit?.byTeam, { name: g.homeTeamKey, key: g.homeTeamKey })?.shrunken ?? CHAMPION_HFA),
    marketResidual: compare((g) => lookupTeamRating(marketFit?.byTeam, { name: g.homeTeamKey, key: g.homeTeamKey })?.shrunken ?? CHAMPION_HFA),
  };
}

export function yearToYearCorrelation(a, b) {
  const keys = Object.keys(a || {}).filter((k) => b?.[k] != null && a[k] != null);
  if (keys.length < 8) return { n: keys.length, corr: null };
  const xs = keys.map((k) => Number(a[k]));
  const ys = keys.map((k) => Number(b[k]));
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const corr = dx && dy ? num / Math.sqrt(dx * dy) : null;
  return { n: keys.length, corr };
}

export { BLUECHIP_META };
