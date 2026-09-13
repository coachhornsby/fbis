/**
 * NHL research / provider-gated architecture.
 * Do not scrape around commercial licensing requirements.
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

export const NHL_PROVIDER_STATUS = Object.freeze({
  implementation: "PROVIDER_OR_LICENSE_BLOCKED",
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
});

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
      ...NHL_PROVIDER_STATUS,
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
    ...NHL_PROVIDER_STATUS,
  };
}

export function nhlResearchContracts() {
  return {
    modelId: NHL_PURE_CHALLENGER_ID,
    modelVersion: NHL_PURE_CHALLENGER_VERSION,
    family: MODEL_FAMILY.PURE,
    ...NHL_PROVIDER_STATUS,
    uiStates: Object.freeze(["NO_MODEL", "RESEARCH", "PROVIDER_OR_LICENSE_BLOCKED"]),
    gradingInfrastructure: "shared-model-lab",
  };
}
