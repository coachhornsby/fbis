/**
 * Model family registry — freezes verified incumbents; challengers are explicit.
 * Sport manuals override shared defaults when more specific.
 */

import {
  MODEL_FAMILY,
  MODEL_MATURITY,
  canShowValidatedProbability,
} from "./maturityStates.js";

/**
 * @typedef {{
 *  modelId: string,
 *  sport: string,
 *  family: string,
 *  displayName: string,
 *  maturity: string,
 *  role: 'champion'|'challenger'|'baseline'|'shadow'|'market-baseline',
 *  artifactRef: string|null,
 *  coefficientsLocked: boolean,
 *  calibrationLocked: boolean,
 *  canQualify: boolean,
 *  canAuthorizeWager: boolean,
 *  marketInformed: boolean,
 *  independent: boolean,
 *  preservesIncumbent: boolean,
 *  notes: string,
 * }} ModelRegistration
 */

/** @type {ModelRegistration[]} */
export const MODEL_REGISTRY = Object.freeze([
  {
    modelId: "CFB-FBIS-v2",
    sport: "cfb",
    family: MODEL_FAMILY.PURE,
    displayName: "CFB FBIS v2 (locked M*/T*)",
    maturity: MODEL_MATURITY.PRODUCTION_CHAMPION,
    role: "champion",
    artifactRef: "data/models/cfb-fbis-v2-fitted-aa.js",
    coefficientsLocked: true,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes:
      "Manual: preserve locked M*=A / T*=A. Display production projection; wager gates remain off until explicit promotion.",
  },
  {
    modelId: "CFB-PLAYER-v1",
    sport: "cfb",
    family: MODEL_FAMILY.PLAYER,
    displayName: "CFB Player v1 (QB1/RB1/WR1)",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "shadow",
    artifactRef: "data/models/cfb-player-v1.js",
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "Provisional/unfitted package — research only. Per-market maturity required before authority.",
  },
  {
    modelId: "CFB-MARKET-SHADOW",
    sport: "cfb",
    family: MODEL_FAMILY.MARKET,
    displayName: "CFB Market challenger slot",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: null,
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: true,
    independent: false,
    preservesIncumbent: true,
    notes: "Separately named MARKET family only. May not rewrite CFB-FBIS-v2.",
  },
  {
    modelId: "MLB-SAVANT-RPG-SP",
    sport: "mlb",
    family: MODEL_FAMILY.PURE,
    displayName: "MLB Savant RPG × Starting Pitcher",
    maturity: MODEL_MATURITY.PRODUCTION_CHAMPION,
    role: "champion",
    artifactRef: "functions/lib/savant.js",
    coefficientsLocked: true,
    calibrationLocked: false,
    canQualify: true,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "Incumbent independent MLB scores. Qualify still requires Pin two-way + integrity gates.",
  },
  {
    modelId: "MLB-FBIS-v2",
    sport: "mlb",
    family: MODEL_FAMILY.PURE,
    displayName: "MLB FBIS v2 Pal-feature challenger",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: null,
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "Research shadow: Savant/starter/bullpen plus PIT Pal park/matchup/lineup features. Pal final scores and probabilities remain external benchmarks and never enter FBIS score.",
  },
  {
    modelId: "CBB-FBIS-PURE",
    sport: "cbb",
    family: MODEL_FAMILY.PURE,
    displayName: "CBB FBIS Pure (revalidation)",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: null,
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "Manual: retain/repair/revalidate. Board Pin-implied scores are NOT this model.",
  },
  {
    modelId: "CBB-PINNACLE-IMPLIED",
    sport: "cbb",
    family: MODEL_FAMILY.MARKET,
    displayName: "CBB Pinnacle-implied board scores",
    maturity: MODEL_MATURITY.BASELINE_ONLY,
    role: "market-baseline",
    artifactRef: null,
    coefficientsLocked: true,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: true,
    independent: false,
    preservesIncumbent: true,
    notes: "Current board behavior for CBB scores — market baseline, not PURE champion.",
  },
  {
    modelId: "NFL-PINNACLE-IMPLIED",
    sport: "nfl",
    family: MODEL_FAMILY.MARKET,
    displayName: "NFL Pinnacle-implied board scores",
    maturity: MODEL_MATURITY.BASELINE_ONLY,
    role: "market-baseline",
    artifactRef: null,
    coefficientsLocked: true,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: true,
    independent: false,
    preservesIncumbent: true,
    notes: "Preserve until independent NFL PURE challenger earns locked OOS.",
  },
  {
    modelId: "NFL-PRO-v1",
    sport: "nfl",
    family: MODEL_FAMILY.PURE,
    displayName: "NFL Pro v1 challenger",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: null,
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "Research challenger only.",
  },
  {
    modelId: "NFL-FBIS-PURE",
    sport: "nfl",
    family: MODEL_FAMILY.PURE,
    displayName: "NFL FBIS Pure research-v0-form",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: "functions/lib/nflPureChallenger.js",
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    // LIVE_OPERATIONAL is evidence-derived at runtime via /api/health ops — not a static claim.
    notes:
      "Live research-v0-form baseline (team-form priors). RESEARCH only — never qualifies/authorizes. LIVE_OPERATIONAL from production ops telemetry.",
  },
  {
    modelId: "NBA-PINNACLE-IMPLIED",
    sport: "nba",
    family: MODEL_FAMILY.MARKET,
    displayName: "NBA Pinnacle-implied board scores",
    maturity: MODEL_MATURITY.BASELINE_ONLY,
    role: "market-baseline",
    artifactRef: null,
    coefficientsLocked: true,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: true,
    independent: false,
    preservesIncumbent: true,
    notes: "Board placeholder until NBA PURE + player opportunity models exist.",
  },
  {
    modelId: "NBA-FBIS-PURE",
    sport: "nba",
    family: MODEL_FAMILY.PURE,
    displayName: "NBA FBIS Pure (provider-gated)",
    maturity: MODEL_MATURITY.INSUFFICIENT_DATA,
    role: "challenger",
    artifactRef: "functions/lib/nbaResearchArchitecture.js",
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "PROVIDER_OR_LICENSE_BLOCKED for production feed. Architecture + opportunity contract implemented.",
  },
  {
    modelId: "NHL-PLAYER-PRO-v2",
    sport: "nhl",
    family: MODEL_FAMILY.PLAYER,
    displayName: "NHL Player Pro v2",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: "data/models/nhl-player-pro-v2.js",
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "Validated research-only NHL player props. SOG and saves are the strongest promoted research markets; saves confidence uses starter confirmation, model-to-line gap, and historical shot-environment subsets. Wager authority remains disabled.",
  },
  {
    modelId: "NHL-WIN-v1",
    sport: "nhl",
    family: MODEL_FAMILY.PURE,
    displayName: "NHL WIN v1 directional situational head",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: "data/models/nhl-win-v1.js",
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "Directional winner classifier layered on NHL-PRO-v2. Uses PIT-validated rest, B2B, travel, time-zone, return-home/road-trip, arena residual, altitude, xG and goalie context. NHL-PRO-v2 calibrated probability remains unchanged. OOS directional accuracy 54.88% vs 53.73% incumbent on 2025-26; research only.",
  },
  {
    modelId: "NHL-PRO-v2",
    sport: "nhl",
    family: MODEL_FAMILY.PURE,
    displayName: "NHL PRO v2 event-chain challenger",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: "data/models/nhl-pro-v2.js",
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "Event-chain gradient-boosted xG, empirical-Bayes shooter finishing and goalie GSAx, personnel, special teams, NHL EDGE tracking overlay, and bivariate score distribution. Strict 2,624-game PIT historical gate passed for margin, total, and Brier; research-board promotion enabled. Prospective OOS and market-relative validation still required; wager authority remains disabled.",
  },
  {
    modelId: "NHL-FBIS-v1",
    sport: "nhl",
    family: MODEL_FAMILY.PURE,
    displayName: "NHL FBIS v1 five-layer research",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: "data/models/nhl-fbis-v1.js",
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "Five-layer independent NHL research model: historical 5v5 xG, regressed goalie value, special teams, rest/travel/home ice, and probabilistic scoring. Point-in-time historical core validated across 2,624 games; qualification remains disabled pending prospective OOS and market-relative calibration.",
  },
  {
    modelId: "NHL-FBIS-PURE",
    sport: "nhl",
    family: MODEL_FAMILY.PURE,
    displayName: "NHL FBIS Pure research-v0-team-prior",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: "functions/lib/nhlResearchModel.js",
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "Live independent opening-season team-prior baseline. RESEARCH only: no qualification or wager authority. Goalie, 5v5 xG, and special-teams layers remain unvalidated.",
  },
  {
    modelId: "SOCCER-FBIS-v1",
    sport: "soccer",
    family: MODEL_FAMILY.PURE,
    displayName: "Soccer FBIS v1 Dixon-Coles research",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: "functions/lib/soccerFbisV1.js",
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes:
      "Point-in-time canonical results, recency-weighted league environment, shrunk home/away attack-defense rates, Dixon-Coles score distribution. 1X2/totals/BTTS/AH research only until market and prospective gates pass.",
  },
  {
    modelId: "SOCCER-FBIS-v2",
    sport: "soccer",
    family: MODEL_FAMILY.PURE,
    displayName: "Soccer FBIS v2 structural incumbent",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "baseline",
    artifactRef: "functions/lib/soccerFbisV2.js",
    coefficientsLocked: true,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes:
      "Structural incumbent for Phase 3 league × market-family comparisons. Authoritative route remains v2 unless an explicit later operator-approved production cutover occurs.",
  },
  {
    modelId: "SOCCER-FBIS-v3.1",
    sport: "soccer",
    family: MODEL_FAMILY.PURE,
    displayName: "Soccer FBIS v3.1 advanced-data score-layer challenger",
    maturity: MODEL_MATURITY.RESEARCH,
    role: "challenger",
    artifactRef: "functions/lib/soccerFbisV3.js",
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes:
      "Advanced xG/PPDA/field-tilt/network challenger. League × market-family research routing only; persistent state excluded; no automatic qualification or wager authority.",
  },
]);

export function getModel(modelId) {
  return MODEL_REGISTRY.find((m) => m.modelId === modelId) || null;
}

export function listModels({ sport = null, family = null, maturity = null } = {}) {
  return MODEL_REGISTRY.filter((m) => {
    if (sport && m.sport !== String(sport).toLowerCase()) return false;
    if (family && m.family !== family) return false;
    if (maturity && m.maturity !== maturity) return false;
    return true;
  });
}

export function listChampions() {
  return MODEL_REGISTRY.filter((m) => m.maturity === MODEL_MATURITY.PRODUCTION_CHAMPION);
}

export function assertChampionFrozen(modelId) {
  const m = getModel(modelId);
  if (!m) return { ok: false, reason: "unknown-model" };
  if (m.coefficientsLocked && m.preservesIncumbent) {
    return {
      ok: true,
      frozen: true,
      modelId: m.modelId,
      message: "Coefficients locked — create a new challenger version instead of mutating in place.",
    };
  }
  return { ok: true, frozen: false, modelId: m.modelId };
}

export function promotionBlockedReasons(modelId) {
  const m = getModel(modelId);
  if (!m) return ["unknown-model"];
  const reasons = [];
  if (m.maturity !== MODEL_MATURITY.PROMOTION_CANDIDATE) {
    reasons.push(`maturity-is-${m.maturity}`);
  }
  if (!m.coefficientsLocked && m.family === MODEL_FAMILY.PURE) {
    // challengers may unlock; champions must be locked before promote
  }
  if (m.canAuthorizeWager) reasons.push("unexpected-auto-authorize-flag");
  if (m.marketInformed && m.family === MODEL_FAMILY.PURE) {
    reasons.push("market-informed-pure-illegal");
  }
  return reasons;
}

/** Hard product rule: never auto-promote. */
export function autoPromoteAllowed() {
  return false;
}

export function probabilityDisplayAllowed(modelId) {
  const m = getModel(modelId);
  if (!m) return false;
  return canShowValidatedProbability(m.maturity, m.calibrationLocked);
}

export function buildModelRegistryReport() {
  const champions = listChampions();
  return {
    generatedAt: new Date().toISOString(),
    count: MODEL_REGISTRY.length,
    champions: champions.map((c) => c.modelId),
    autoPromoteAllowed: autoPromoteAllowed(),
    models: MODEL_REGISTRY,
  };
}
