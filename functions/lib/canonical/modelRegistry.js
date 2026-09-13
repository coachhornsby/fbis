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
    modelId: "MLB-RUN-ALLOC-v1",
    sport: "mlb",
    family: MODEL_FAMILY.PURE,
    displayName: "MLB Run Allocation v1",
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
    notes: "Shadow run-allocation challenger — cannot silently replace Savant path.",
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
    modelId: "NHL-FBIS-PURE",
    sport: "nhl",
    family: MODEL_FAMILY.PURE,
    displayName: "NHL FBIS Pure (feasibility)",
    maturity: MODEL_MATURITY.INSUFFICIENT_DATA,
    role: "challenger",
    artifactRef: null,
    coefficientsLocked: false,
    calibrationLocked: false,
    canQualify: false,
    canAuthorizeWager: false,
    marketInformed: false,
    independent: true,
    preservesIncumbent: true,
    notes: "Manual: feasibility/research until PIT team/shot/ST/goalie proof.",
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
