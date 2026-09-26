/**
 * CFB-FBIS-v2 — independent opponent-adjusted CFB projection.
 *
 * Production projection cutover uses fitted M*=A / T*=A ridge coefficients
 * (data/models/cfb-fbis-v2-fitted-aa.js). Qualification and wager authorization
 * remain disabled. Never consumes market lines for score generation.
 */

import { CHAMPION_HFA, NEUTRAL_HFA, COLLEGE_MODELS, failClosedShadow } from "./collegeModels.js";
import { pGreater } from "./metrics.js";
import { blendPriorCurrent, shrinkageWeight } from "./cfbFeatureStore.js";
import { predictRidge, pHomeWinFromMargin } from "./cfbFbisV2Fit.js";
import CFB_FBIS_V2_ARTIFACT from "../../data/models/cfb-fbis-v2.js";
import CFB_FBIS_V2_FITTED_AA from "../../data/models/cfb-fbis-v2-fitted-aa.js";

export const CFB_FBIS_V2_ID = "CFB-FBIS-v2";
export const CFB_FBIS_V2_PRODUCTION = CFB_FBIS_V2_FITTED_AA;

export const ABLATION_MASKS = {
  A: { base: true },
  B: { base: true, pass: true, rush: true },
  C: { base: true, pass: true, rush: true, success: true },
  D: { base: true, pass: true, rush: true, success: true, explosiveness: true },
  E: { base: true, pass: true, rush: true, success: true, explosiveness: true, havoc: true },
  F: { base: true, pass: true, rush: true, success: true, explosiveness: true, havoc: true, trenches: true },
  G: { base: true, pass: true, rush: true, success: true, explosiveness: true, havoc: true, trenches: true, finishing: true },
  H: { base: true, pass: true, rush: true, success: true, explosiveness: true, havoc: true, trenches: true, finishing: true, qb: true },
  I: { base: true, pass: true, rush: true, success: true, explosiveness: true, havoc: true, trenches: true, finishing: true, qb: true, pace: true },
  J: { base: true, pass: true, rush: true, success: true, explosiveness: true, havoc: true, trenches: true, finishing: true, qb: true, pace: true, context: true },
  K: { base: true, pass: true, rush: true, success: true, explosiveness: true, havoc: true, trenches: true, finishing: true, qb: true, pace: true, context: true },
};

const DEFAULT_COEF = CFB_FBIS_V2_ARTIFACT.coefficients;

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function fairAmerican(p) {
  const pp = Math.min(0.999, Math.max(0.001, Number(p) || 0.5));
  if (pp >= 0.5) return Math.round(-100 * pp / (1 - pp));
  return Math.round(100 * (1 - pp) / pp);
}

function sideFeatures(game, side) {
  const explicit = game?.cfbFbisV2Input?.[side] || game?.cfbDeepInput?.[side] || {};
  const est = game?.cfb?.[`${side}Est`] || {};
  const detail = game?.cfbDetail?.[side] || {};
  const fv = est.featureVector || {};
  const merged = {
    priorOff: detail.priorOff ?? est.priorOff,
    priorDef: detail.priorDef ?? est.priorDef,
    off: detail.off ?? est.off,
    def: detail.def ?? est.def,
    gamesPlayed: detail.games ?? est.games ?? detail.gamesPlayed,
    qbStarterKnown: detail.qb?.starterKnown,
    qbName: detail.qb?.starterName,
    starterTransfer: detail.qb?.starterTransfer,
    classification: detail.classification || est.classification,
    fbsEquivalentPower: detail.fbsEquivalentPower ?? est.fbsEquivalentPower,
    ...fv.raw,
    ...fv,
    ...explicit,
  };
  return merged;
}

function venueHfa(game, hfa = CHAMPION_HFA) {
  if (game?.neutralSite || game?.neutral) return NEUTRAL_HFA;
  return hfa;
}

function zDiff(off, def, scale = 1) {
  const o = num(off);
  const d = num(def);
  if (o == null || d == null) return null;
  return (o - d) * scale;
}

function applyMask(points, mask) {
  const out = {};
  for (const [k, v] of Object.entries(points)) {
    if (mask[k]) out[k] = v;
  }
  return out;
}

function sum(obj) {
  return Object.values(obj).reduce((a, b) => a + (num(b) || 0), 0);
}

function missingPenalty(values) {
  const keys = Object.keys(values);
  if (!keys.length) return 1;
  const present = keys.filter((k) => values[k] != null).length;
  return present / keys.length;
}

/**
 * FCS → conference → FBS-equivalent. Missing strength ⇒ PROVISIONAL + wider sigma.
 */
export function fcsStrengthAdjustment(input = {}, coef = DEFAULT_COEF.fcs) {
  const classification = String(input.classification || input.division || "").toUpperCase();
  const isFcs = classification.includes("FCS") || Boolean(input.isFcs);
  if (!isFcs) return { points: 0, provisional: false, state: "FBS" };
  const power = num(input.fbsEquivalentPower ?? input.fcsEquivalentPower ?? input.srs ?? input.eloPower);
  if (power == null) {
    return {
      points: 0,
      provisional: true,
      state: "PROVISIONAL",
      reason: "fcs-strength-unavailable",
      uncertaintyMult: coef.missingUncertaintyMult,
    };
  }
  return {
    points: Math.max(-coef.maxAbs, Math.min(coef.maxAbs, power * coef.scale)),
    provisional: false,
    state: "FCS_EQUIVALENT",
    equivalentPower: power,
    uncertaintyMult: 1 + Math.max(0, coef.baseUncertaintyBump),
  };
}

/**
 * QB residual above/below team pass baseline — structurally separate to avoid double count.
 */
export function qbValueAdjustment(input = {}, coef = DEFAULT_COEF.qb) {
  const qbPpa = num(input.qbPpa ?? input.qbEpa ?? input.passingPpa);
  const teamPass = num(input.passEpa ?? input.passingPpaTeam ?? input.ppaOffensePassing);
  const known = Boolean(input.qbStarterKnown ?? input.starterKnown ?? (input.qbName || input.starterName));
  if (!known && qbPpa == null) {
    return { points: 0, uncertaintyMult: coef.unknownMult, state: "UNKNOWN" };
  }
  if (qbPpa == null) {
    return { points: 0, uncertaintyMult: coef.limitedSampleMult, state: "LIMITED" };
  }
  const residual = teamPass == null ? qbPpa * coef.rawScale : (qbPpa - teamPass) * coef.residualScale;
  const capped = Math.max(-coef.maxAbs, Math.min(coef.maxAbs, residual));
  const transfer = Boolean(input.qbTransfer || input.starterTransfer);
  return {
    points: capped,
    residual: round2(residual),
    uncertaintyMult: transfer ? coef.transferMult : input.qbGamesPlayed < 3 ? coef.limitedSampleMult : 1,
    state: transfer ? "TRANSFER" : "KNOWN",
  };
}

export function uncertaintyModel({
  gamesPlayed = 0,
  priorWeight = 1,
  qbUncertaintyMult = 1,
  fcsUncertaintyMult = 1,
  dataCompleteness = 1,
  componentDisagreement = 0,
  weatherUncertainty = 0,
  baseMarginSigma = DEFAULT_COEF.marginSigma,
  baseTotalSigma = DEFAULT_COEF.totalSigma,
} = {}) {
  const early = Math.max(0, 1 - shrinkageWeight(gamesPlayed, 6));
  const priorShare = Math.max(priorWeight, early);
  const missing = Math.max(0, 1 - dataCompleteness);
  const marginSigma = round2(
    baseMarginSigma *
      (1 + 0.35 * priorShare + 0.4 * missing + 0.15 * componentDisagreement + 0.1 * weatherUncertainty) *
      qbUncertaintyMult *
      fcsUncertaintyMult
  );
  const totalSigma = round2(baseTotalSigma * (marginSigma / baseMarginSigma));
  let uncertaintyState = "LOW";
  if (marginSigma >= 20 || dataCompleteness < 0.45 || priorShare > 0.75) uncertaintyState = "HIGH";
  else if (marginSigma >= 17 || dataCompleteness < 0.7 || priorShare > 0.45) uncertaintyState = "MEDIUM";
  return {
    margin_sigma: marginSigma,
    total_sigma: totalSigma,
    home_score_sigma: round2(totalSigma * 0.72),
    away_score_sigma: round2(totalSigma * 0.72),
    model_quality: round2(Math.max(0, Math.min(1, dataCompleteness * (1 - 0.35 * priorShare)))),
    data_completeness: round2(dataCompleteness),
    uncertainty_state: uncertaintyState,
    prior_share: round2(priorShare),
  };
}

function weatherContextPoints(input = {}, coef = DEFAULT_COEF.context) {
  if (input.gameIndoors || input.dome) return { weather: 0, travel: num(input.travelPoints) || 0, rest: num(input.restPoints) || 0 };
  const wind = num(input.windSpeed);
  const temp = num(input.temperature);
  let weather = 0;
  if (wind != null && wind >= coef.windThreshold) weather += coef.windPenalty;
  if (temp != null && temp <= coef.coldThreshold) weather += coef.coldPenalty;
  return {
    weather: round2(weather),
    travel: num(input.travelPoints) || 0,
    rest: num(input.restPoints) || 0,
  };
}

/**
 * Project one game. Inputs are pregame feature vectors only — caller enforces temporal cutoff.
 * Market fields on `game` are ignored for independent score.
 */
export function projectCfbFbisV2(game = {}, { ablation = "K", coefficients = DEFAULT_COEF, shrinkK = 6 } = {}) {
  const mask = ABLATION_MASKS[ablation] || ABLATION_MASKS.K;
  const homeIn = sideFeatures(game, "home");
  const awayIn = sideFeatures(game, "away");
  const hfa = venueHfa(game, coefficients.hfa ?? CHAMPION_HFA);

  const homeGames = num(homeIn.gamesPlayed) || 0;
  const awayGames = num(awayIn.gamesPlayed) || 0;
  const national = coefficients.nationalPpg;
  const ppaToPoints = (ppa) => {
    const v = num(ppa);
    return v == null ? null : national + v * 40;
  };

  // Training/serving contract: when overall PPA is available, current
  // strength is PPA-derived on both historical and live paths. Raw scoring PPG
  // is diagnostic and only a fallback when PPA is genuinely unavailable.
  const homeCurrentOff =
    ppaToPoints(homeIn.offensePpa) ??
    homeIn.offensePpaPoints ??
    homeIn.off ??
    ppaToPoints(homeIn.passEpa);
  const homeCurrentDef =
    ppaToPoints(homeIn.defensePpa) ??
    homeIn.defensePpaPoints ??
    homeIn.def ??
    ppaToPoints(homeIn.passEpaAllowed);
  const awayCurrentOff =
    ppaToPoints(awayIn.offensePpa) ??
    awayIn.offensePpaPoints ??
    awayIn.off ??
    ppaToPoints(awayIn.passEpa);
  const awayCurrentDef =
    ppaToPoints(awayIn.defensePpa) ??
    awayIn.defensePpaPoints ??
    awayIn.def ??
    ppaToPoints(awayIn.passEpaAllowed);

  const homeOff = blendPriorCurrent(
    homeIn.priorOff ?? homeIn.spOffense ?? homeCurrentOff,
    homeCurrentOff,
    homeGames,
    shrinkK
  );
  const homeDef = blendPriorCurrent(
    homeIn.priorDef ?? homeIn.spDefense ?? homeCurrentDef,
    homeCurrentDef,
    homeGames,
    shrinkK
  );
  const awayOff = blendPriorCurrent(
    awayIn.priorOff ?? awayIn.spOffense ?? awayCurrentOff,
    awayCurrentOff,
    awayGames,
    shrinkK
  );
  const awayDef = blendPriorCurrent(
    awayIn.priorDef ?? awayIn.spDefense ?? awayCurrentDef,
    awayCurrentDef,
    awayGames,
    shrinkK
  );

  if ([homeOff.value, homeDef.value, awayOff.value, awayDef.value].some((v) => !Number.isFinite(v))) {
    return {
      modelId: CFB_FBIS_V2_ID,
      ...COLLEGE_MODELS[CFB_FBIS_V2_ID],
      ok: false,
      reason: "missing-base-power",
      canQualify: false,
      independent: true,
      marketInformed: false,
    };
  }

  const baseHome = homeOff.value + (awayDef.value - national);
  const baseAway = awayOff.value + (homeDef.value - national);
  const baseMargin = baseHome - baseAway;
  const baseTotal = baseHome + baseAway;

  const pass = zDiff(homeIn.passEpa ?? homeIn.ppaOffensePassing, awayIn.passEpaAllowed ?? awayIn.ppaDefensePassing, coefficients.scales.pass);
  const rush = zDiff(homeIn.rushEpa ?? homeIn.ppaOffenseRushing, awayIn.rushEpaAllowed ?? awayIn.ppaDefenseRushing, coefficients.scales.rush);
  const success = zDiff(homeIn.successRate, awayIn.successRateAllowed, coefficients.scales.success);
  const explosiveness = zDiff(homeIn.explosiveRate ?? homeIn.explosiveness, awayIn.explosiveRateAllowed, coefficients.scales.explosiveness);
  const havoc = zDiff(awayIn.havocRate, homeIn.havocAllowed, coefficients.scales.havoc);
  const trenches = zDiff(homeIn.lineYards, awayIn.lineYardsAllowed, coefficients.scales.trenches);
  const finishing = zDiff(homeIn.pointsPerOpportunity, awayIn.pointsPerOpportunityAllowed, coefficients.scales.finishing);

  const homeQb = qbValueAdjustment(homeIn, coefficients.qb);
  const awayQb = qbValueAdjustment(awayIn, coefficients.qb);
  const qb = (homeQb.points || 0) - (awayQb.points || 0);

  const paceHome = num(homeIn.paceNorm) || 0;
  const paceAway = num(awayIn.paceNorm) || 0;
  const pace = (paceHome - paceAway) * coefficients.scales.pace;

  const ctxHome = weatherContextPoints(homeIn, coefficients.context);
  const ctxAway = weatherContextPoints(awayIn, coefficients.context);
  const weather = (ctxHome.weather || 0) - (ctxAway.weather || 0);
  const travel = (ctxAway.travel || 0) - (ctxHome.travel || 0);
  const rest = (ctxHome.rest || 0) - (ctxAway.rest || 0);

  const homeFcs = fcsStrengthAdjustment(homeIn, coefficients.fcs);
  const awayFcs = fcsStrengthAdjustment(awayIn, coefficients.fcs);
  const fcs = (homeFcs.points || 0) - (awayFcs.points || 0);

  const rawComponents = {
    base: round2(baseMargin),
    pass: pass == null ? null : round2(pass),
    rush: rush == null ? null : round2(rush),
    success: success == null ? null : round2(success),
    explosiveness: explosiveness == null ? null : round2(explosiveness),
    havoc: havoc == null ? null : round2(havoc),
    trenches: trenches == null ? null : round2(trenches),
    finishing: finishing == null ? null : round2(finishing),
    qb: round2(qb),
    pace: round2(pace),
    context: round2(hfa + weather + travel + rest + fcs),
  };

  // Zero-fill is forbidden for missing matchup edges — omit from sum (treat as null → 0 contribution but tracked).
  const masked = applyMask(
    {
      base: rawComponents.base,
      pass: rawComponents.pass ?? 0,
      rush: rawComponents.rush ?? 0,
      success: rawComponents.success ?? 0,
      explosiveness: rawComponents.explosiveness ?? 0,
      havoc: rawComponents.havoc ?? 0,
      trenches: rawComponents.trenches ?? 0,
      finishing: rawComponents.finishing ?? 0,
      qb: rawComponents.qb,
      pace: rawComponents.pace,
      context: rawComponents.context,
    },
    mask
  );

  const rawMargin = sum(masked);
  const reliability = 0.5 * (homeOff.weight + awayOff.weight);
  // Shrink toward 0 when unreliable (early season): move raw margin toward 0
  const reliabilityShrink = round2(-rawMargin * (1 - reliability) * coefficients.reliabilityShrink);
  const finalMargin = round1(rawMargin + reliabilityShrink);
  const expectedPossessions = coefficients.expectedPossessions + pace * coefficients.possessionPaceScale;
  const homePpp = Math.max(0.1, (national + finalMargin / 2) / expectedPossessions);
  const awayPpp = Math.max(0.1, (national - finalMargin / 2) / expectedPossessions);
  let projHome = round1(homePpp * expectedPossessions);
  let projAway = round1(awayPpp * expectedPossessions);
  // Keep margin identity with final fair line
  const marginCheck = round1(projHome - projAway);
  if (Math.abs(marginCheck - finalMargin) > 0.15) {
    projHome = round1(national + finalMargin / 2);
    projAway = round1(national - finalMargin / 2);
  }
  const total = round1(projHome + projAway);

  const completeness = missingPenalty({
    pass: rawComponents.pass,
    rush: rawComponents.rush,
    success: rawComponents.success,
    explosiveness: rawComponents.explosiveness,
    havoc: rawComponents.havoc,
    trenches: rawComponents.trenches,
    finishing: rawComponents.finishing,
  });

  const presentMatchup = ["pass", "rush", "success", "explosiveness", "havoc", "trenches", "finishing"]
    .map((k) => rawComponents[k])
    .filter((v) => v != null);
  const disagreement =
    presentMatchup.length >= 2
      ? Math.min(1, Math.abs(Math.max(...presentMatchup) - Math.min(...presentMatchup)) / 8)
      : 0;

  const unc = uncertaintyModel({
    gamesPlayed: Math.min(homeGames, awayGames),
    priorWeight: 1 - reliability,
    qbUncertaintyMult: Math.max(homeQb.uncertaintyMult || 1, awayQb.uncertaintyMult || 1),
    fcsUncertaintyMult: Math.max(homeFcs.uncertaintyMult || 1, awayFcs.uncertaintyMult || 1),
    dataCompleteness: completeness,
    componentDisagreement: disagreement,
    weatherUncertainty: Math.abs(weather) > 0 ? 0.2 : 0,
  });

  const provisional = homeFcs.provisional || awayFcs.provisional || unc.uncertainty_state === "HIGH";
  const decomposition = {
    BASE_POWER: rawComponents.base,
    BASE_TOTAL: round2(baseTotal),
    PASS_MATCHUP: rawComponents.pass,
    RUSH_MATCHUP: rawComponents.rush,
    SUCCESS: rawComponents.success,
    EXPLOSIVENESS: rawComponents.explosiveness,
    HAVOC: rawComponents.havoc,
    TRENCHES: rawComponents.trenches,
    FINISHING_DRIVES: rawComponents.finishing,
    QB: rawComponents.qb,
    PACE: rawComponents.pace,
    HFA: hfa,
    WEATHER_CONTEXT: round2(weather + travel + rest + fcs),
    RAW_MARGIN: round2(rawMargin),
    RELIABILITY_SHRINK: reliabilityShrink,
    FINAL_FAIR_LINE: finalMargin,
    PROJECTED_TOTAL: total,
    ablation,
    mask,
  };

  const componentSum =
    (mask.base ? rawComponents.base : 0) +
    (mask.pass ? rawComponents.pass || 0 : 0) +
    (mask.rush ? rawComponents.rush || 0 : 0) +
    (mask.success ? rawComponents.success || 0 : 0) +
    (mask.explosiveness ? rawComponents.explosiveness || 0 : 0) +
    (mask.havoc ? rawComponents.havoc || 0 : 0) +
    (mask.trenches ? rawComponents.trenches || 0 : 0) +
    (mask.finishing ? rawComponents.finishing || 0 : 0) +
    (mask.qb ? rawComponents.qb || 0 : 0) +
    (mask.pace ? rawComponents.pace || 0 : 0) +
    (mask.context ? rawComponents.context || 0 : 0);

  const reconcileOk = Math.abs(componentSum - rawMargin) < 0.05;

  // Market isolation: ignore pinSpread/pinTotal for projection identity
  const marketIgnored = {
    pinSpread: game?.pinSpread ?? game?.odds?.pinSpread ?? null,
    pinTotal: game?.pinTotal ?? game?.odds?.pinTotal ?? null,
    used: false,
  };

  const projection = {
    modelId: CFB_FBIS_V2_ID,
    ...COLLEGE_MODELS[CFB_FBIS_V2_ID],
    ok: true,
    home: projHome,
    away: projAway,
    margin: finalMargin,
    total,
    pHomeWin: pGreater(finalMargin, 0, unc.margin_sigma),
    pAwayWin: round2(1 - pGreater(finalMargin, 0, unc.margin_sigma)),
    fairHomeMl: fairAmerican(pGreater(finalMargin, 0, unc.margin_sigma)),
    fairAwayMl: fairAmerican(1 - pGreater(finalMargin, 0, unc.margin_sigma)),
    away_expected_points: projAway,
    home_expected_points: projHome,
    fair_margin: finalMargin,
    fair_total: total,
    sigmaMargin: unc.margin_sigma,
    sigmaTotal: unc.total_sigma,
    home_score_sigma: unc.home_score_sigma,
    away_score_sigma: unc.away_score_sigma,
    independent: true,
    marketInformed: false,
    canQualify: false,
    ablation,
    decomposition,
    uncertainty: unc,
    dataCompleteness: unc.data_completeness,
    provisional,
    provenance: {
      marketUsed: false,
      marketIgnored,
      championOverwritten: false,
      hfa: hfa,
      shrinkK,
      artifactId: CFB_FBIS_V2_ARTIFACT.id,
      sourceVersion: CFB_FBIS_V2_ARTIFACT.sourceVersion,
      reconcileOk,
      temporalCallerResponsible: true,
    },
    fcs: { home: homeFcs, away: awayFcs },
    qb: { home: homeQb, away: awayQb },
  };

  return {
    ...projection,
    ...failClosedShadow({
      identityOk: Boolean(game?.home && game?.away),
      projectionState: provisional ? "PROVISIONAL" : "COMPLETE",
      featuresOk: completeness >= 0.2,
      artifactKnown: Boolean(CFB_FBIS_V2_ARTIFACT?.coefficients),
      cutoffOk: game?.featureCutoffOk !== false,
      marketPaired: false,
      pricePresent: false,
      dataQuality: unc.data_completeness,
      pinnacleOnly: false,
      modelId: CFB_FBIS_V2_ID,
    }),
  };
}

/** Deterministic helper for tests: same inputs ⇒ same outputs. */
export function projectCfbFbisV2Deterministic(game, opts) {
  return projectCfbFbisV2(game, opts);
}

function sideSum(a, b) {
  const x = num(a);
  const y = num(b);
  if (x == null && y == null) return null;
  return (x || 0) + (y || 0);
}

/**
 * Apply fitted M*=A / T*=A ridge on top of provisional feature decomposition.
 * Intercept/beta are verbatim from fitted-coefficients-final.json fold3 A.
 * canQualify / canAuthorize stay false.
 */
export function applyFittedProjection(provisional, game = {}, fitted = CFB_FBIS_V2_FITTED_AA) {
  if (!provisional?.ok) {
    return {
      ...provisional,
      modelId: CFB_FBIS_V2_ID,
      projectionEnabled: Boolean(fitted?.projectionEnabled),
      canQualify: false,
      canAuthorize: false,
      Mstar: fitted?.Mstar || "A",
      Tstar: fitted?.Tstar || "A",
      fittedApplied: false,
    };
  }

  const homeIn = sideFeatures(game, "home");
  const awayIn = sideFeatures(game, "away");
  const d = provisional.decomposition || {};

  const marginFeatureMap = {
    base: num(d.BASE_POWER),
    pass: num(d.PASS_MATCHUP),
    rush: num(d.RUSH_MATCHUP),
    success: num(d.SUCCESS),
    explosiveness: num(d.EXPLOSIVENESS),
    havoc: num(d.HAVOC),
    trenches: num(d.TRENCHES),
    finishing: num(d.FINISHING_DRIVES),
    qb: num(d.QB),
    pace: num(d.PACE),
    context: sideSum(d.HFA, d.WEATHER_CONTEXT),
  };
  const totalFeatureMap = {
    base_total: num(d.BASE_TOTAL),
    pass_total: sideSum(homeIn.passEpa, awayIn.passEpa),
    rush_total: sideSum(homeIn.rushEpa, awayIn.rushEpa),
    success_total: sideSum(homeIn.successRate, awayIn.successRate),
    explosiveness_total: sideSum(
      homeIn.explosiveRate ?? homeIn.explosiveness,
      awayIn.explosiveRate ?? awayIn.explosiveness
    ),
    havoc_total: sideSum(homeIn.havocRate, awayIn.havocRate),
    trenches_total: sideSum(homeIn.lineYards, awayIn.lineYards),
    finishing_total: sideSum(homeIn.pointsPerOpportunity, awayIn.pointsPerOpportunity),
    qb_total: sideSum(homeIn.qbPpa, awayIn.qbPpa),
    pace_total: sideSum(homeIn.paceNorm, awayIn.paceNorm),
    context_total: num(d.WEATHER_CONTEXT),
  };

  const marginNames = Array.isArray(fitted?.margin?.features) && fitted.margin.features.length
    ? fitted.margin.features
    : ["base"];
  const totalNames = Array.isArray(fitted?.total?.features) && fitted.total.features.length
    ? fitted.total.features
    : ["base_total"];
  const marginX = marginNames.map((name) => marginFeatureMap[name] ?? null);
  const totalX = totalNames.map((name) => totalFeatureMap[name] ?? null);

  if (!Number.isFinite(marginFeatureMap.base) || !Number.isFinite(totalFeatureMap.base_total)) {
    return {
      ...provisional,
      ok: false,
      reason: "missing-fitted-base",
      canQualify: false,
      canAuthorize: false,
      fittedApplied: false,
    };
  }

  const marginModel = {
    intercept: fitted.margin.intercept,
    beta: fitted.margin.beta,
    means: fitted.margin.means,
    stds: fitted.margin.stds,
  };
  const totalModel = {
    intercept: fitted.total.intercept,
    beta: fitted.total.beta,
    means: fitted.total.means,
    stds: fitted.total.stds,
  };

  const predMargin = predictRidge(marginModel, [marginX])[0];
  const predTotal = predictRidge(totalModel, [totalX])[0];
  if (!Number.isFinite(predMargin) || !Number.isFinite(predTotal)) {
    return {
      ...provisional,
      ok: false,
      reason: "fitted-predict-failed",
      canQualify: false,
      canAuthorize: false,
      fittedApplied: false,
    };
  }

  const home = round1((predTotal + predMargin) / 2);
  const away = round1((predTotal - predMargin) / 2);
  const margin = round1(home - away);
  const total = round1(home + away);
  const sigma = Number(fitted.margin.sigma) || Number(provisional.sigmaMargin) || 16.5;
  const pHome = pHomeWinFromMargin(margin, sigma);

  return {
    ...provisional,
    modelId: CFB_FBIS_V2_ID,
    version: fitted.version || "v2-fitted-production",
    ok: true,
    home,
    away,
    margin,
    total,
    pHomeWin: pHome,
    pAwayWin: round2(1 - pHome),
    fairHomeMl: fairAmerican(pHome),
    fairAwayMl: fairAmerican(1 - pHome),
    away_expected_points: away,
    home_expected_points: home,
    fair_margin: margin,
    fair_total: total,
    sigmaMargin: sigma,
    independent: true,
    marketInformed: false,
    projectionEnabled: true,
    canQualify: false,
    canAuthorize: false,
    Mstar: fitted.Mstar,
    Tstar: fitted.Tstar,
    ablation: `M:${fitted.Mstar}+T:${fitted.Tstar}`,
    fittedApplied: true,
    productionFold: fitted.productionFold || "fold3",
    marginFeatures: Object.fromEntries(marginNames.map((name, i) => [name, marginX[i]])),
    totalFeatures: Object.fromEntries(totalNames.map((name, i) => [name, totalX[i]])),
    provenance: {
      ...(provisional.provenance || {}),
      fittedArtifactId: fitted.id,
      fittedCoefficientsSha256: fitted.sourceArtifacts?.fittedCoefficientsFinalSha256 || null,
      coherentScores: true,
      trainingServingContract: "ppa-derived-base-v2",
      championOverwritable: true,
      marketUsed: false,
    },
    ...failClosedShadow({
      identityOk: Boolean(game?.home && game?.away),
      projectionState: provisional.provisional ? "PROVISIONAL" : "COMPLETE",
      featuresOk: true,
      artifactKnown: true,
      cutoffOk: game?.featureCutoffOk !== false,
      marketPaired: false,
      pricePresent: false,
      dataQuality: provisional.dataCompleteness ?? 1,
      pinnacleOnly: false,
      modelId: CFB_FBIS_V2_ID,
    }),
  };
}

// Backward-compatible export name; implementation is no longer A/A-specific.
export const applyFittedAaProjection = applyFittedProjection;

export function projectCfbFbisV2Production(game = {}, opts = {}) {
  const provisional = projectCfbFbisV2(game, { ...opts, ablation: opts.ablation || "K" });
  return applyFittedProjection(provisional, game, opts.fitted || CFB_FBIS_V2_FITTED_AA);
}

export function attachCfbFbisV2(games = [], opts = {}) {
  let available = 0;
  let fittedOk = 0;
  const useFitted = opts.useFittedAa !== false;
  const next = (games || []).map((game) => {
    if (game.sport && game.sport !== "cfb") return game;
    const projection = useFitted
      ? projectCfbFbisV2Production(game, opts)
      : projectCfbFbisV2(game, opts);
    if (projection.ok) available += 1;
    if (projection.fittedApplied) fittedOk += 1;
    return {
      ...game,
      challengers: { ...(game.challengers || {}), [CFB_FBIS_V2_ID]: projection },
      cfbFbisV2: projection,
    };
  });
  return {
    games: next,
    meta: {
      modelId: CFB_FBIS_V2_ID,
      role: useFitted ? "production-projection" : "shadow",
      Mstar: CFB_FBIS_V2_FITTED_AA.Mstar,
      Tstar: CFB_FBIS_V2_FITTED_AA.Tstar,
      games: next.length,
      available,
      fittedOk,
      projectionEnabled: true,
      qualificationAllowed: false,
      canQualify: false,
      canAuthorize: false,
    },
  };
}

/**
 * Promote fitted CFB-FBIS-v2 A/A scores onto the board projection fields.
 * Never enables qualification or wager authorization.
 */
export function promoteCfbFbisV2ToBoard(games = []) {
  let promoted = 0;
  const next = (games || []).map((game) => {
    if (game.sport && game.sport !== "cfb") return game;
    const projection = game.cfbFbisV2 || game.challengers?.[CFB_FBIS_V2_ID];
    if (!projection?.ok || !projection.fittedApplied) return game;
    promoted += 1;
    return {
      ...game,
      projHomeScore: projection.home,
      projAwayScore: projection.away,
      modelVersion: CFB_FBIS_V2_ID,
      projectionKind: "FBIS",
      projectionEngine: CFB_FBIS_V2_ID,
      projectionArchitecture: { Mstar: projection.Mstar || "A", Tstar: projection.Tstar || "A" },
      qualificationBlocked: true,
      cfb: {
        ...(game.cfb || {}),
        bettingAllowed: false,
        blockReason: "CFB-FBIS-v2 projection cutover — qualification disabled",
        productionModelId: CFB_FBIS_V2_ID,
        Mstar: projection.Mstar || "A",
        Tstar: projection.Tstar || "A",
        fittedApplied: true,
        home: projection.home,
        away: projection.away,
        margin: projection.margin,
        total: projection.total,
      },
    };
  });
  return {
    games: next,
    meta: {
      modelId: CFB_FBIS_V2_ID,
      promoted,
      canQualify: false,
      canAuthorize: false,
    },
  };
}

export function ablationSuite(game, opts = {}) {
  return Object.keys(ABLATION_MASKS).map((key) => ({
    ablation: key,
    projection: projectCfbFbisV2(game, { ...opts, ablation: key }),
  }));
}
