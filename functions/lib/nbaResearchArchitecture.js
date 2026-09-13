/**
 * NBA research / provider-gated architecture.
 * Market-implied scores must never qualify.
 */

import { MODEL_FAMILY, MODEL_MATURITY, COMMERCIAL_STATUS } from "./canonical/maturityStates.js";
import { marketImpliedAuthority } from "./canonical/decisionAuthority.js";

export const NBA_PURE_CHALLENGER_ID = "NBA-FBIS-PURE";
export const NBA_PURE_CHALLENGER_VERSION = "research-v0";

export const NBA_AVAILABILITY_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  PROBABLE: "PROBABLE",
  QUESTIONABLE: "QUESTIONABLE",
  DOUBTFUL: "DOUBTFUL",
  OUT: "OUT",
  UNKNOWN: "UNKNOWN",
});

export const NBA_SUPPORTED_PROPS = Object.freeze([
  "points",
  "rebounds",
  "assists",
  "threes",
  "pra",
  "pa",
  "pr",
  "ra",
]);

export const NBA_PROVIDER_STATUS = Object.freeze({
  implementation: "PROVIDER_OR_LICENSE_BLOCKED",
  maturity: MODEL_MATURITY.INSUFFICIENT_DATA,
  canQualify: false,
  canAuthorizeWager: false,
  missingDependency:
    "Rights-cleared machine-readable NBA production feed (NBA.com/Stats not licensed for production redistribution)",
  commercialStatus: COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
  pillars: Object.freeze([
    "player_value",
    "expected_minutes",
    "lineups",
    "availability",
    "matchup",
    "schedule_rest",
    "expected_possessions",
    "ppp",
    "team_score_distribution",
  ]),
  supportedProps: NBA_SUPPORTED_PROPS,
  availabilityStates: NBA_AVAILABILITY_STATUS,
  expectedMinutesFirstClass: true,
  combinationPropsCovarianceAware: true,
});

export function buildNbaPlayerOpportunity({
  playerId = null,
  expectedMinutes = null,
  availability = NBA_AVAILABILITY_STATUS.UNKNOWN,
  perMinuteRate = null,
  usage = null,
  opponentFactor = null,
  pace = null,
} = {}) {
  const minutesKnown = expectedMinutes != null && Number.isFinite(Number(expectedMinutes));
  const rateKnown = perMinuteRate != null && Number.isFinite(Number(perMinuteRate));
  if (!minutesKnown || !rateKnown) {
    return {
      ok: false,
      reason: "opportunity-inputs-missing",
      playerId,
      availability,
      expectedMinutes: minutesKnown ? Number(expectedMinutes) : null,
      ...NBA_PROVIDER_STATUS,
    };
  }
  const raw = Number(expectedMinutes) * Number(perMinuteRate);
  const adjusted =
    raw *
    (usage == null ? 1 : Number(usage) || 1) *
    (opponentFactor == null ? 1 : Number(opponentFactor) || 1) *
    (pace == null ? 1 : Number(pace) || 1);
  return {
    ok: true,
    playerId,
    availability,
    expectedMinutes: Number(expectedMinutes),
    perMinuteRate: Number(perMinuteRate),
    expectedStat: adjusted,
    covarianceAwareCombosRequired: true,
    canShowEv: false,
    canQualify: false,
    family: MODEL_FAMILY.PLAYER,
    ...NBA_PROVIDER_STATUS,
  };
}

export function nbaMarketImpliedCannotQualify(projectionKind) {
  const auth = marketImpliedAuthority(projectionKind);
  return {
    canQualify: false,
    canAuthorizeWager: false,
    reasonCode: auth.reasonCode,
    displayLabel: auth.displayLabel || "MARKET-IMPLIED SCORE",
  };
}
