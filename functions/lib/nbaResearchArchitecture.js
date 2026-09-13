/**
 * NBA research architecture — split provider block from buildable engineering.
 *
 * PROVIDER_OR_LICENSE_BLOCKED applies only to licensed feed ingestion / redistribution.
 * Provider-independent contracts remain IMPLEMENTATION_PENDING or IMPLEMENTED_SCAFFOLD.
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

/** Exact components that require a rights-cleared production feed. */
export const NBA_PROVIDER_BLOCKED = Object.freeze([
  "production_stats_ingestion",
  "live_availability_feed",
  "official_lineup_redistribution",
]);

/** Provider-independent engineering that can proceed without the licensed feed. */
export const NBA_BUILDABLE = Object.freeze([
  {
    requirement: "player_opportunity_contract",
    status: "IMPLEMENTED_SCAFFOLD",
    module: "buildNbaPlayerOpportunity",
  },
  {
    requirement: "availability_state_enum",
    status: "IMPLEMENTED",
    module: "NBA_AVAILABILITY_STATUS",
  },
  {
    requirement: "supported_prop_market_list",
    status: "IMPLEMENTED",
    module: "NBA_SUPPORTED_PROPS",
  },
  {
    requirement: "market_implied_cannot_qualify_guard",
    status: "IMPLEMENTED",
    module: "nbaMarketImpliedCannotQualify",
  },
  {
    requirement: "team_score_distribution_model",
    status: "IMPLEMENTATION_PENDING",
    module: null,
  },
  {
    requirement: "expected_possessions_ppp_model",
    status: "IMPLEMENTATION_PENDING",
    module: null,
  },
  {
    requirement: "combination_prop_covariance",
    status: "IMPLEMENTATION_PENDING",
    module: null,
  },
  {
    requirement: "shadow_freeze_grade_path",
    status: "IMPLEMENTATION_PENDING",
    module: null,
  },
  {
    requirement: "identity_publication_contracts",
    status: "IMPLEMENTED_SCAFFOLD",
    module: "canonical lineage + publication ledger (shared)",
  },
]);

export const NBA_PROVIDER_STATUS = Object.freeze({
  implementation: "PROVIDER_OR_LICENSE_BLOCKED",
  blockedComponents: NBA_PROVIDER_BLOCKED,
  buildableComponents: NBA_BUILDABLE,
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
  note: "Provider block does not excuse unfinished provider-independent model/grade/publication work",
});

export function nbaComponentAudit() {
  return {
    providerOrLicenseBlocked: [...NBA_PROVIDER_BLOCKED],
    buildable: NBA_BUILDABLE,
  };
}

/**
 * Provider-independent opportunity math. Inputs must be supplied by caller
 * (fixtures / licensed feed). Does not fetch NBA.com.
 */
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
      implementation: "IMPLEMENTED_SCAFFOLD",
      ingestionStatus: "PROVIDER_OR_LICENSE_BLOCKED",
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
    implementation: "IMPLEMENTED_SCAFFOLD",
    ingestionStatus: "PROVIDER_OR_LICENSE_BLOCKED",
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
