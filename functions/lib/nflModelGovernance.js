/**
 * NFL model governance constants.
 * Single source of truth for champion vs displayed research vs shadow challengers.
 * Changing these values does NOT promote a model or authorize wagers.
 */

export const NFL_PRODUCTION_CHAMPION = Object.freeze({
  modelId: "NFL-PRO-v1.1",
  version: "v1.1",
  role: "production-champion",
  canQualify: true,
  canAuthorizeWager: false,
  note: "Governance champion identity. Board research display may use a later research revision without promoting this champion.",
});

export const NFL_DISPLAYED_RESEARCH = Object.freeze({
  modelId: "NFL-PRO-v1",
  version: "v1.2",
  role: "research-board-primary",
  canQualify: false,
  canAuthorizeWager: false,
  displayLabel: "FBIS NFL-PRO-v1.2 RESEARCH PROJECTION",
  note: "Displayed board research score. Not the production champion. Not injury-aware. Not bet-eligible.",
});

export const NFL_QB_PERSONNEL_CHALLENGER = Object.freeze({
  modelId: "NFL-QB-PERSONNEL-OVERLAY-v1",
  role: "shadow-challenger",
  canQualify: false,
  canAuthorizeWager: false,
  consumesVerifiedAvailability: true,
  note: "Authorized to consume verified QB/personnel availability in SHADOW only. Does not alter the displayed v1.2 research score or champion.",
});

export const NFL_PLAYER_PROP_RESEARCH = Object.freeze({
  modelId: "NFL-PLAYER-PROJ-v3.1",
  role: "player-prop-research",
  canQualify: false,
  canAuthorizeWager: false,
  confidenceStarsBlockedAbove: 3,
  note: "Player props are evaluated separately from game-line projections and wagering performance.",
});

export function nflGovernanceStamp(extra = {}) {
  return {
    championModel: NFL_PRODUCTION_CHAMPION.modelId,
    championModelVersion: NFL_PRODUCTION_CHAMPION.version,
    displayedResearchModel: NFL_DISPLAYED_RESEARCH.modelId,
    displayedResearchVersion: NFL_DISPLAYED_RESEARCH.version,
    productionChampionUnchanged: true,
    wagerAuthorityUnchanged: true,
    ...extra,
  };
}
