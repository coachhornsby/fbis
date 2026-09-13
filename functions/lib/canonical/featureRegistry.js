/**
 * Feature registry + PURE contamination firewall.
 *
 * PURE game and player models may not ingest sportsbook prices, public splits,
 * ACTION data, line movement, consensus, book disagreement, CLV, closing line,
 * postgame results, or derivatives of these.
 */

import { FEATURE_STATUS, MODEL_FAMILY } from "./maturityStates.js";
import { REASON_CODE } from "./decisionAuthority.js";

export const PROHIBITED_PURE_MARKET_FIELDS = Object.freeze([
  "sportsbook_spread",
  "sportsbook_total",
  "sportsbook_moneyline",
  "sportsbook_price",
  "american_odds",
  "decimal_odds",
  "implied_probability_market",
  "public_ticket_pct",
  "public_money_pct",
  "ticket_percentage",
  "money_percentage",
  "action_observation",
  "action_consensus",
  "line_movement",
  "opening_line",
  "closing_line",
  "clv",
  "consensus_line",
  "book_disagreement",
  "pinnacle_spread",
  "pinnacle_total",
  "pinnacle_ml",
  "heritage_price",
  "postgame_result",
  "final_score",
  "actual_home",
  "actual_away",
  "market_implied_score",
  "sharp_signal",
]);

const PROHIBITED_SET = new Set(PROHIBITED_PURE_MARKET_FIELDS.map((f) => f.toLowerCase()));

export const FEATURE_REGISTRY = Object.freeze([
  feature({
    featureId: "cfb.pure.team_off_epa",
    sport: "cfb",
    modelFamily: MODEL_FAMILY.PURE,
    featureName: "team_off_epa",
    sourceProvider: "cfbd",
    rawFields: ["offense.epa"],
    transformation: "season_to_date_mean_pit",
    units: "epa/play",
    ablationGroup: "efficiency",
  }),
  feature({
    featureId: "cbb.pure.adj_oe",
    sport: "cbb",
    modelFamily: MODEL_FAMILY.PURE,
    featureName: "adj_oe",
    sourceProvider: "kenpom_api",
    rawFields: ["AdjOE"],
    transformation: "as_of_data_through",
    units: "pts/100",
    ablationGroup: "four_factors",
  }),
  feature({
    featureId: "cbb.pure.adj_de",
    sport: "cbb",
    modelFamily: MODEL_FAMILY.PURE,
    featureName: "adj_de",
    sourceProvider: "kenpom_api",
    rawFields: ["AdjDE"],
    transformation: "as_of_data_through",
    units: "pts/100",
    ablationGroup: "four_factors",
  }),
  feature({
    featureId: "cbb.pure.adj_tempo",
    sport: "cbb",
    modelFamily: MODEL_FAMILY.PURE,
    featureName: "adj_tempo",
    sourceProvider: "kenpom_api",
    rawFields: ["AdjTempo"],
    transformation: "as_of_data_through",
    units: "poss/40",
    ablationGroup: "tempo",
  }),
  feature({
    featureId: "nfl.pure.early_down_success",
    sport: "nfl",
    modelFamily: MODEL_FAMILY.PURE,
    featureName: "early_down_success_rate",
    sourceProvider: "nflverse",
    rawFields: ["success", "down"],
    transformation: "rolling_pit_mean",
    units: "rate",
    ablationGroup: "success",
  }),
  feature({
    featureId: "mlb.pure.sp_xera",
    sport: "mlb",
    modelFamily: MODEL_FAMILY.PURE,
    featureName: "starter_xera",
    sourceProvider: "baseball_savant",
    rawFields: ["xera"],
    transformation: "season_to_date_pit",
    units: "era",
    ablationGroup: "pitching",
  }),
  feature({
    featureId: "market.action.public_ticket_pct",
    sport: "multi",
    modelFamily: MODEL_FAMILY.MARKET,
    featureName: "public_ticket_pct",
    sourceProvider: "action_apify",
    rawFields: ["ticketPercentage"],
    transformation: "identity",
    units: "pct",
    ablationGroup: "public_splits",
    validationStatus: FEATURE_STATUS.EVALUATION_ONLY,
  }),
]);

function feature(partial) {
  return Object.freeze({
    featureId: partial.featureId,
    sport: partial.sport,
    modelFamily: partial.modelFamily,
    featureName: partial.featureName,
    sourceProvider: partial.sourceProvider,
    rawFields: Object.freeze([...(partial.rawFields || [])]),
    transformation: partial.transformation || "identity",
    effectiveAtRule: partial.effectiveAtRule || "effective_at <= information_cutoff",
    informationCutoffRule:
      partial.informationCutoffRule || "information_cutoff < event_start",
    missingnessPolicy: partial.missingnessPolicy || "EXPLICIT_NULL_NO_SILENT_ZERO",
    fallbackPolicy: partial.fallbackPolicy || "NONE_FAIL_VISIBLE",
    units: partial.units || "",
    version: partial.version || "v1",
    ablationGroup: partial.ablationGroup ?? null,
    ablationStatus: partial.ablationStatus || FEATURE_STATUS.CHALLENGER,
    validationStatus: partial.validationStatus || FEATURE_STATUS.EVALUATION_ONLY,
    commercialStatus: partial.commercialStatus || "RESEARCH_ONLY",
  });
}

export function listFeatures({ sport = null, modelFamily = null } = {}) {
  return FEATURE_REGISTRY.filter((f) => {
    if (sport && f.sport !== String(sport).toLowerCase() && f.sport !== "multi") return false;
    if (modelFamily && f.modelFamily !== modelFamily) return false;
    return true;
  });
}

export function getFeature(featureId) {
  return FEATURE_REGISTRY.find((f) => f.featureId === featureId) || null;
}

export function assertPureManifestClean(fieldNames = [], modelFamily = MODEL_FAMILY.PURE) {
  if (modelFamily !== MODEL_FAMILY.PURE && modelFamily !== MODEL_FAMILY.PLAYER) {
    return { ok: true, contaminants: [], reasonCode: null };
  }
  const contaminants = [];
  for (const raw of fieldNames) {
    const name = String(raw || "").trim().toLowerCase();
    if (!name) continue;
    if (PROHIBITED_SET.has(name)) {
      contaminants.push(name);
      continue;
    }
    for (const banned of PROHIBITED_SET) {
      if (name.includes(banned) || banned.includes(name)) {
        contaminants.push(name);
        break;
      }
    }
  }
  if (contaminants.length) {
    return {
      ok: false,
      contaminants: [...new Set(contaminants)],
      reasonCode: REASON_CODE.DATA_QUALITY_BLOCK,
      message: "PURE/PLAYER feature manifest contains prohibited market fields",
    };
  }
  return { ok: true, contaminants: [], reasonCode: null };
}

export function assertActionCannotEnterPure(fieldNames = [], targetFamily = MODEL_FAMILY.PURE) {
  const actionLike = fieldNames
    .map((f) => String(f || "").toLowerCase())
    .filter(
      (f) =>
        f.includes("action") ||
        f.includes("ticket_pct") ||
        f.includes("money_pct") ||
        f.includes("public_ticket") ||
        f.includes("public_money") ||
        f.includes("clv") ||
        f.includes("line_movement")
    );
  if (
    actionLike.length &&
    (targetFamily === MODEL_FAMILY.PURE || targetFamily === MODEL_FAMILY.PLAYER)
  ) {
    return {
      ok: false,
      contaminants: actionLike,
      reasonCode: REASON_CODE.ACTION_CANNOT_QUALIFY,
      message: "ACTION cannot enter PURE game/player features",
    };
  }
  return { ok: true, contaminants: [], reasonCode: null };
}

export function buildFeatureManifest({
  modelId,
  modelFamily,
  sport,
  featureIds = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const features = featureIds.map((id) => getFeature(id)).filter(Boolean);
  const fieldNames = features.flatMap((f) => [f.featureName, ...f.rawFields]);
  const purity = assertPureManifestClean(fieldNames, modelFamily);
  const action = assertActionCannotEnterPure(fieldNames, modelFamily);
  return {
    modelId: modelId || null,
    modelFamily: modelFamily || null,
    sport: sport || null,
    generatedAt,
    featureIds: features.map((f) => f.featureId),
    features,
    purityOk: purity.ok && action.ok,
    blockers: [...(purity.contaminants || []), ...(action.contaminants || [])],
    missingnessPolicy: "EXPLICIT_NULL_NO_SILENT_ZERO",
  };
}
