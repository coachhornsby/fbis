/**
 * NHL research architecture — split commercial feed block from buildable contracts.
 */

import { MODEL_FAMILY, MODEL_MATURITY, COMMERCIAL_STATUS } from "./canonical/maturityStates.js";

export const NHL_PURE_CHALLENGER_ID = "NHL-FBIS-PURE";
export const NHL_PURE_CHALLENGER_VERSION = "research-v0";

export const NHL_GOALIE_STATUS = Object.freeze({
  CONFIRMED_STARTER: "CONFIRMED_STARTER",
  EXPECTED_STARTER: "EXPECTED_STARTER",
  BACKUP: "BACKUP",
  UNKNOWN: "UNKNOWN",
});

export const NHL_PROVIDER_BLOCKED = Object.freeze([
  "production_stats_ingestion",
  "live_line_toi_feed",
  "official_goalie_confirmation_redistribution",
]);

export const NHL_BUILDABLE = Object.freeze([
  {
    requirement: "goalie_status_enum",
    status: "IMPLEMENTED",
    module: "NHL_GOALIE_STATUS",
  },
  {
    requirement: "player_opportunity_contract",
    status: "IMPLEMENTED_SCAFFOLD",
    module: "buildNhlPlayerOpportunity",
  },
  {
    requirement: "player_market_list",
    status: "IMPLEMENTED",
    module: "NHL_PROVIDER_STATUS.playerMarkets",
  },
  {
    requirement: "five_v_five_xg_model",
    status: "IMPLEMENTATION_PENDING",
    module: null,
  },
  {
    requirement: "special_teams_model",
    status: "IMPLEMENTATION_PENDING",
    module: null,
  },
  {
    requirement: "shadow_freeze_grade_path",
    status: "IMPLEMENTATION_PENDING",
    module: null,
  },
  {
    requirement: "distribution_calibrator_validation",
    status: "IMPLEMENTATION_PENDING",
    module: null,
  },
  {
    requirement: "identity_publication_contracts",
    status: "IMPLEMENTED_SCAFFOLD",
    module: "canonical shared ledger",
  },
]);

export const NHL_PROVIDER_STATUS = Object.freeze({
  implementation: "PROVIDER_OR_LICENSE_BLOCKED",
  blockedComponents: NHL_PROVIDER_BLOCKED,
  buildableComponents: NHL_BUILDABLE,
  maturity: MODEL_MATURITY.INSUFFICIENT_DATA,
  canQualify: false,
  canAuthorizeWager: false,
  missingDependency:
    "Rights-cleared machine-readable NHL production feed (commercial agreement not obtained)",
  commercialStatus: COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
  teamResearch: Object.freeze([
    "five_v_five_xg",
    "chance_quality",
    "goalie_value",
    "special_teams",
    "finishing_regression",
    "lineup_context",
    "expected_goals",
  ]),
  playerMarkets: Object.freeze([
    "sog",
    "goals",
    "assists",
    "points",
    "goalie_saves",
    "goals_allowed",
  ]),
  goalieFirstClass: true,
  note: "Provider block covers ingestion only; model/grade/publication engineering stays IMPLEMENTATION_PENDING until built",
});

export function nhlComponentAudit() {
  return {
    providerOrLicenseBlocked: [...NHL_PROVIDER_BLOCKED],
    buildable: NHL_BUILDABLE,
  };
}

export function buildNhlPlayerOpportunity({
  playerId = null,
  toiMinutes = null,
  goalieStatus = NHL_GOALIE_STATUS.UNKNOWN,
  eventRate = null,
  market = null,
} = {}) {
  const toiOk = toiMinutes != null && Number.isFinite(Number(toiMinutes));
  const rateOk = eventRate != null && Number.isFinite(Number(eventRate));
  if (!toiOk || !rateOk) {
    return {
      ok: false,
      reason: "opportunity-inputs-missing",
      playerId,
      goalieStatus,
      market,
      implementation: "IMPLEMENTED_SCAFFOLD",
      ingestionStatus: "PROVIDER_OR_LICENSE_BLOCKED",
    };
  }
  return {
    ok: true,
    playerId,
    market,
    goalieStatus,
    toiMinutes: Number(toiMinutes),
    eventRate: Number(eventRate),
    expectedEvents: Number(toiMinutes) * Number(eventRate),
    canShowEv: false,
    canQualify: false,
    family: MODEL_FAMILY.PLAYER,
    distributionValidated: false,
    calibratorValidated: false,
    implementation: "IMPLEMENTED_SCAFFOLD",
    ingestionStatus: "PROVIDER_OR_LICENSE_BLOCKED",
  };
}

export function nhlResearchContracts() {
  return {
    modelId: NHL_PURE_CHALLENGER_ID,
    modelVersion: NHL_PURE_CHALLENGER_VERSION,
    family: MODEL_FAMILY.PURE,
    ...NHL_PROVIDER_STATUS,
    componentAudit: nhlComponentAudit(),
    uiStates: Object.freeze(["NO_MODEL", "RESEARCH", "PROVIDER_OR_LICENSE_BLOCKED"]),
    gradingInfrastructure: "shared-model-lab-reusable-but-nhl-path-not-wired",
  };
}
