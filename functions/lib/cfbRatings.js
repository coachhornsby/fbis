/**
 * Transparent CFB challenger ratings. Champion HFA stays 2.5 / 0.
 * These models are shadow and never mix market lines into independent features.
 */

import { CHAMPION_HFA, NEUTRAL_HFA, COLLEGE_MODELS, failClosedShadow } from "./collegeModels.js";
import { pGreater } from "./metrics.js";
import CFB_REG from "../../data/models/cfb-cfbd-reg-v1.js";

export const CFB_LEAGUE_PPG = 26.5;
export const CFB_LEAGUE_TOTAL = 53;
export const CFB_MARGIN_SIGMA = 15.5;
export const CFB_TOTAL_SIGMA = 13.5;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function identity(home, away) {
  return {
    home,
    away,
    total: round1(home + away),
    margin: round1(home - away),
  };
}

export function venueHfa(game, hfa = CHAMPION_HFA) {
  if (game?.neutralSite || game?.neutral) return NEUTRAL_HFA;
  return hfa;
}

export function pinnacleImplied(game) {
  const total = num(game?.odds?.pinTotal ?? game?.odds?.total ?? game?.pinTotal);
  const spread = num(game?.odds?.pinSpread ?? game?.odds?.spread ?? game?.pinSpread);
  if (total == null || spread == null) {
    return { ok: false, reason: "incomplete-market", home: null, away: null, total: null, margin: null };
  }
  const home = round1(total / 2 - spread / 2);
  const away = round1(total / 2 + spread / 2);
  return { ok: true, ...identity(home, away), label: "PINNACLE IMPLIED SCORE", independent: false };
}

export function cfbLeagueBaseline(game, { hfa = CHAMPION_HFA } = {}) {
  const h = venueHfa(game, hfa);
  const home = round1(CFB_LEAGUE_PPG + h / 2);
  const away = round1(CFB_LEAGUE_PPG - h / 2);
  return {
    modelId: "CFB-LEAGUE-BASELINE",
    ...COLLEGE_MODELS["CFB-LEAGUE-BASELINE"],
    ...identity(home, away),
    hfa: h,
    formula: "league_ppg ± HFA/2; HFA=2.5 true home else 0",
    featuresOk: true,
  };
}

/**
 * Opponent-adjusted expected score from frozen CFBD off/def (points scale).
 * home = home_off + (away_def - league) * 0.5 wait:
 * Transparent: each side scores (own offense + opponent defense) / 2 ± HFA/2
 * using ratings only — no current-season form (that is the champion).
 */
export function cfbRatingsV1(game, { homeOff, homeDef, awayOff, awayDef, hfa = CHAMPION_HFA, national = CFB_LEAGUE_PPG } = {}) {
  if ([homeOff, homeDef, awayOff, awayDef].some((v) => num(v) == null)) {
    return { modelId: "CFB-CFBD-RATINGS-v1", ok: false, reason: "missing-ratings", home: null, away: null, featuresOk: false };
  }
  const h = venueHfa(game, hfa);
  const home = round1((Number(homeOff) + Number(awayDef)) / 2 + h / 2);
  const away = round1((Number(awayOff) + Number(homeDef)) / 2 - h / 2);
  return {
    modelId: "CFB-CFBD-RATINGS-v1",
    ...COLLEGE_MODELS["CFB-CFBD-RATINGS-v1"],
    ok: true,
    ...identity(home, away),
    hfa: h,
    national,
    formula: "home=(homeOff+awayDef)/2+HFA/2; away=(awayOff+homeDef)/2-HFA/2; national environment frozen",
    featuresOk: true,
  };
}

export function applyRidge(features, artifact) {
  const coef = artifact?.coefficients || {};
  const names = artifact?.featureNames || Object.keys(coef).filter((k) => k !== "intercept");
  let y = Number(coef.intercept || 0);
  for (const name of names) {
    y += Number(coef[name] || 0) * Number(features[name] || 0);
  }
  return y;
}

export function cfbRegV1(game, features = {}, artifact = CFB_REG) {
  if (!artifact?.coefficients) {
    return { modelId: "CFB-CFBD-REG-v1", ok: false, reason: "unknown-artifact", featuresOk: false };
  }
  const required = artifact.requiredFeatures || ["home_off", "home_def", "away_off", "away_def"];
  if (required.some((k) => num(features[k]) == null)) {
    return { modelId: "CFB-CFBD-REG-v1", ok: false, reason: "missing-features", featuresOk: false };
  }
  const hfa = venueHfa(game, features.hfa ?? CHAMPION_HFA);
  const feat = { ...features, hfa, intercept: 1 };
  const home = round1(applyRidge(feat, { ...artifact, coefficients: artifact.coefficients.home || artifact.coefficients }));
  const awayCoef = artifact.coefficients.away
    ? { coefficients: artifact.coefficients.away, featureNames: artifact.featureNames }
    : {
        coefficients: {
          intercept: artifact.coefficients.intercept,
          home_off: artifact.coefficients.away_off,
          home_def: artifact.coefficients.away_def,
          away_off: artifact.coefficients.home_off,
          away_def: artifact.coefficients.home_def,
          hfa: -(artifact.coefficients.hfa || 0),
          talent_diff: -(artifact.coefficients.talent_diff || 0),
          returning_diff: -(artifact.coefficients.returning_diff || 0),
        },
        featureNames: artifact.featureNames,
      };
  const away = round1(applyRidge(feat, awayCoef));
  return {
    modelId: "CFB-CFBD-REG-v1",
    ...COLLEGE_MODELS["CFB-CFBD-REG-v1"],
    ok: true,
    ...identity(home, away),
    hfa,
    artifactId: artifact.id,
    trainingCutoff: artifact.trainingCutoff,
    featuresOk: true,
  };
}

export function independentEnsemble(parts, modelId) {
  const usable = (parts || []).filter((p) => p && p.home != null && p.away != null && p.independent !== false && !p.monteCarlo);
  if (!usable.length) return { modelId, ok: false, reason: "no-independent-members", featuresOk: false };
  const home = round1(usable.reduce((s, p) => s + p.home, 0) / usable.length);
  const away = round1(usable.reduce((s, p) => s + p.away, 0) / usable.length);
  return {
    modelId,
    ok: true,
    ...identity(home, away),
    members: usable.map((p) => p.modelId),
    nMembers: usable.length,
    note: "Equal-weight mean of independent predictors. Monte Carlo is not a member.",
    featuresOk: true,
  };
}

export function attachMc(proj, { sigmaMargin = CFB_MARGIN_SIGMA, sigmaTotal = CFB_TOTAL_SIGMA } = {}) {
  if (!proj || proj.home == null) return proj;
  return {
    ...proj,
    sigmaMargin,
    sigmaTotal,
    pHomeWin: pGreater(proj.margin, 0, sigmaMargin),
    monteCarlo: {
      role: "distribution",
      independentForecast: false,
      note: "Supplies win/cover/over probabilities around this model's mean. Not an ensemble member.",
    },
  };
}

export function globalHfaChallenger(game, { seasonHfa = 2.7 } = {}) {
  const h = venueHfa(game, seasonHfa);
  return { modelId: "CFB-HFA-GLOBAL-v1", ...COLLEGE_MODELS["CFB-HFA-GLOBAL-v1"], hfa: h, shrunken: seasonHfa };
}

export function conferenceHfaChallenger(game, { confHfa = 2.4 } = {}) {
  const h = venueHfa(game, confHfa);
  return { modelId: "CFB-HFA-CONF-v1", ...COLLEGE_MODELS["CFB-HFA-CONF-v1"], hfa: h, shrunken: confHfa };
}

export function projectCfbChallengers(game, ctx = {}) {
  const home = ctx.home || {};
  const away = ctx.away || {};
  const identityOk = Boolean(game?.home?.canonicalId && game?.away?.canonicalId);
  const league = cfbLeagueBaseline(game);
  const ratings = cfbRatingsV1(game, {
    homeOff: home.off,
    homeDef: home.def,
    awayOff: away.off,
    awayDef: away.def,
  });
  const reg = cfbRegV1(game, {
    home_off: home.off,
    home_def: home.def,
    away_off: away.off,
    away_def: away.def,
    talent_diff: (num(home.talent) || 0) - (num(away.talent) || 0),
    returning_diff: (num(home.returningPct) || 0) - (num(away.returningPct) || 0),
    hfa: venueHfa(game),
  });
  const pin = pinnacleImplied(game);
  const pinModel = {
    modelId: "CFB-PINNACLE-IMPLIED",
    ...COLLEGE_MODELS["CFB-PINNACLE-IMPLIED"],
    ...pin,
    independent: false,
  };
  const ensemble = independentEnsemble(
    [
      attachMc(league),
      ratings.ok ? attachMc(ratings) : null,
      reg.ok ? attachMc(reg) : null,
    ],
    "CFB-CFBD-ENSEMBLE-v1"
  );
  const models = {
    "CFB-LEAGUE-BASELINE": attachMc(league),
    "CFB-CFBD-RATINGS-v1": ratings.ok ? attachMc(ratings) : ratings,
    "CFB-CFBD-REG-v1": reg.ok ? attachMc(reg) : reg,
    "CFB-CFBD-ENSEMBLE-v1": ensemble.ok ? attachMc(ensemble) : ensemble,
    "CFB-PINNACLE-IMPLIED": pinModel,
    "CFB-HFA-GLOBAL-v1": globalHfaChallenger(game, ctx),
    "CFB-HFA-CONF-v1": conferenceHfaChallenger(game, ctx),
  };
  for (const [id, proj] of Object.entries(models)) {
    models[id] = {
      ...proj,
      ...failClosedShadow({
        identityOk,
        projectionState: ratings.ok ? "COMPLETE" : "PARTIAL",
        featuresOk: proj.featuresOk !== false,
        artifactKnown: id !== "CFB-CFBD-REG-v1" || Boolean(CFB_REG?.coefficients),
        cutoffOk: true,
        marketPaired: pin.ok,
        pricePresent: pin.ok,
        dataQuality: ratings.ok ? 0.7 : 0.2,
        pinnacleOnly: id === "CFB-PINNACLE-IMPLIED",
        modelId: id,
      }),
    };
  }
  return models;
}
