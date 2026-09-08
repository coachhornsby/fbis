/**
 * CFB matchup decomposition challenger v2.
 * Shadow-only. Preserves the production opponent-residual champion and HFA.
 * Uses only pregame, team-specific features already attached to the game or explicit cfbDeepInput.
 */

import { pGreater } from "./metrics.js";
import { clamp, coverageSummary, finite, round1 } from "./deepModelCommon.js";

export const CFB_MATCHUP_V2_ID = "CFB-MATCHUP-v2";
export const CFB_MATCHUP_V2_CONSTANTS = {
  marginSigma: 16.5,
  totalSigma: 14.5,
  maxLayerPoints: 2.25,
  shrink: 0.7,
};

function pick(obj, ...keys) {
  for (const k of keys) {
    const v = finite(obj?.[k]);
    if (v != null) return v;
  }
  return null;
}

function sideInput(game, side) {
  const explicit = game?.cfbDeepInput?.[side] || game?.cfbMatchupInput?.[side] || {};
  const est = game?.cfb?.[`${side}Est`] || {};
  const fv = est.featureVector || {};
  const raw = fv.raw || fv.source || {};
  return { ...raw, ...fv, ...explicit };
}

function zAdv(off, def, scale, cap = 1) {
  const o = finite(off);
  const d = finite(def);
  if (o == null || d == null) return null;
  return clamp((o - d) * scale, -cap, cap);
}

function offenseLayer(off, oppDef) {
  const pass = zAdv(pick(off, "passEpa", "epaPass", "passingPpa"), pick(oppDef, "passEpaAllowed", "defPassEpa", "passingPpaAllowed"), 3.5);
  const rush = zAdv(pick(off, "rushEpa", "epaRush", "rushingPpa"), pick(oppDef, "rushEpaAllowed", "defRushEpa", "rushingPpaAllowed"), 3.5);
  const success = zAdv(pick(off, "successRate", "success"), pick(oppDef, "successRateAllowed", "defSuccessRate"), 5.0);
  const explosive = zAdv(pick(off, "explosiveRate", "explosiveness"), pick(oppDef, "explosiveRateAllowed", "defExplosiveRate"), 4.0);
  const havoc = zAdv(pick(oppDef, "havocRate", "havoc"), pick(off, "havocAllowed", "havocRateAllowed"), 3.5);
  const trenchesRun = zAdv(pick(off, "lineYards", "lineYardsPerCarry"), pick(oppDef, "lineYardsAllowed"), 0.45);
  const pressure = zAdv(pick(oppDef, "pressureRate", "sackRate"), pick(off, "pressureAllowed", "sackRateAllowed"), 3.0);
  const finishing = zAdv(pick(off, "pointsPerOpportunity", "finishingDrives"), pick(oppDef, "pointsPerOpportunityAllowed", "finishingDrivesAllowed"), 0.45);
  const qb = pick(off, "qbComposite", "qbPriorComposite", "qbValue", "qbEpaNorm");
  const pace = pick(off, "paceNorm", "tempoNorm");

  const values = { pass, rush, success, explosive, havoc, trenchesRun, pressure, finishing, qb, pace };
  const capped = (v, mult) => v == null ? 0 : clamp(v * mult, -CFB_MATCHUP_V2_CONSTANTS.maxLayerPoints, CFB_MATCHUP_V2_CONSTANTS.maxLayerPoints);
  return {
    values,
    points: {
      passing: capped(pass, 1.55),
      rushing: capped(rush, 1.1),
      success: capped(success, 0.8),
      explosive: capped(explosive, 1.0),
      havoc: capped(havoc, -0.75),
      trenches: capped((trenchesRun ?? 0) - (pressure ?? 0) * 0.6, 0.85),
      finishing: capped(finishing, 0.7),
      quarterback: capped(qb, 1.25),
      pace: capped(pace, 0.35),
    },
  };
}

function fcsAdjustment(input = {}) {
  const classification = String(input.classification || input.division || "").toUpperCase();
  if (!classification.includes("FCS")) return { points: 0, provisional: false };
  const eq = finite(input.fbsEquivalentPower ?? input.fcsEquivalentPower);
  if (eq == null) return { points: 0, provisional: true, reason: "fcs-equivalent-rating-missing" };
  return { points: clamp(eq * 0.18, -5, 5), provisional: false, equivalentPower: eq };
}

function sumPoints(points = {}) {
  return Object.values(points).reduce((sum, v) => sum + (finite(v) ?? 0), 0);
}

export function projectCfbMatchupV2(game = {}) {
  const baseHome = finite(game?.model?.projHome ?? game?.projHomeScore);
  const baseAway = finite(game?.model?.projAway ?? game?.projAwayScore);
  if (baseHome == null || baseAway == null || (game.projectionKind || game?.model?.projectionKind) !== "FBIS") {
    return { modelId: CFB_MATCHUP_V2_ID, ok: false, reason: "independent-cfb-champion-projection-required", canQualify: false, independent: true, marketInformed: false };
  }

  const homeInput = sideInput(game, "home");
  const awayInput = sideInput(game, "away");
  const home = offenseLayer(homeInput, awayInput);
  const away = offenseLayer(awayInput, homeInput);
  const homeFcs = fcsAdjustment(homeInput);
  const awayFcs = fcsAdjustment(awayInput);
  const homeRaw = sumPoints(home.points) + homeFcs.points;
  const awayRaw = sumPoints(away.points) + awayFcs.points;
  const homeDelta = homeRaw * CFB_MATCHUP_V2_CONSTANTS.shrink;
  const awayDelta = awayRaw * CFB_MATCHUP_V2_CONSTANTS.shrink;
  const projHome = round1(Math.max(0, baseHome + homeDelta));
  const projAway = round1(Math.max(0, baseAway + awayDelta));
  const margin = round1(projHome - projAway);
  const total = round1(projHome + projAway);

  const coverage = coverageSummary({
    pass: home.values.pass != null && away.values.pass != null,
    rush: home.values.rush != null && away.values.rush != null,
    success: home.values.success != null && away.values.success != null,
    explosives: home.values.explosive != null && away.values.explosive != null,
    havoc: home.values.havoc != null && away.values.havoc != null,
    trenches: (home.values.trenchesRun != null || home.values.pressure != null) && (away.values.trenchesRun != null || away.values.pressure != null),
    finishingDrives: home.values.finishing != null && away.values.finishing != null,
    quarterback: home.values.qb != null && away.values.qb != null,
    pace: home.values.pace != null && away.values.pace != null,
  });
  const provisional = homeFcs.provisional || awayFcs.provisional || coverage.share < 0.35;

  return {
    modelId: CFB_MATCHUP_V2_ID,
    version: "v2",
    role: "shadow",
    family: "matchup-decomposition",
    ok: true,
    home: projHome,
    away: projAway,
    margin,
    total,
    pHomeWin: pGreater(margin, 0, CFB_MATCHUP_V2_CONSTANTS.marginSigma),
    sigmaMargin: CFB_MATCHUP_V2_CONSTANTS.marginSigma * (provisional ? 1.15 : 1),
    sigmaTotal: CFB_MATCHUP_V2_CONSTANTS.totalSigma * (provisional ? 1.1 : 1),
    independent: true,
    marketInformed: false,
    canQualify: false,
    coverage,
    provisional,
    decomposition: {
      base: { home: baseHome, away: baseAway, source: "production-opponent-residual" },
      home: { rawPoints: round1(homeRaw), appliedDelta: round1(homeDelta), layers: home.points, fcs: homeFcs },
      away: { rawPoints: round1(awayRaw), appliedDelta: round1(awayDelta), layers: away.points, fcs: awayFcs },
      shrink: CFB_MATCHUP_V2_CONSTANTS.shrink,
    },
    provenance: {
      marketUsed: false,
      championOverwritten: false,
      hfaChanged: false,
      missingFeaturesRemainMissing: true,
      fcsFailClosedToProvisional: true,
    },
  };
}

export function attachCfbMatchupV2(games = []) {
  let available = 0;
  const next = (games || []).map((game) => {
    if (game.sport && game.sport !== "cfb") return game;
    const projection = projectCfbMatchupV2(game);
    if (projection.ok) available += 1;
    return {
      ...game,
      challengers: { ...(game.challengers || {}), [CFB_MATCHUP_V2_ID]: projection },
      cfbMatchupV2: projection,
    };
  });
  return { games: next, meta: { modelId: CFB_MATCHUP_V2_ID, role: "shadow", games: next.length, available, qualificationAllowed: false } };
}
