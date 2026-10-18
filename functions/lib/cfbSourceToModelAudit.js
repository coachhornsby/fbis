/**
 * Per-game source → model consumption audit (addendum §12).
 * Distinguishes available / collected / archived / normalized / champion /
 * challenger / CORE research / excluded.
 */

import { auditTeamFeatureUsage } from "./cfbFeatureUsageAudit.js";
import { buildScoringProvenance } from "./cfbSourceModelMatrix.js";
import { buildGameMatchupFeatures } from "./cfbAdvancedResearchFeatures.js";
import { assignFeatureLevel, FEATURE_LEVEL } from "./cfbTier3Entitlements.js";
import { summarizeSdvRegistry } from "./cfbSdvSourceRegistry.js";
import { summarizeCfbdRegistry } from "./cfbCfbdSourceRegistry.js";
import { resolveGamesPlayedWithSource } from "./cfbGamesPlayed.js";

export const SOURCE_MODEL_AUDIT_VERSION = "cfb-source-to-model-audit-v1";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build audit for one matchup given home/away feature snapshots + optional projection.
 */
export function buildSourceToModelAudit({
  game = {},
  homeFeatures = {},
  awayFeatures = {},
  projection = null,
  challengerIds = [],
  coreResearchEligible = true,
  sdvAvailable = false,
  archived = true,
  throughWeek = null,
  collectionBatchId = null,
} = {}) {
  const homeGp = resolveGamesPlayedWithSource(homeFeatures);
  const awayGp = resolveGamesPlayedWithSource(awayFeatures);
  const homeAudit = auditTeamFeatureUsage({
    ...homeFeatures,
    ppaOff: num(homeFeatures.ppaOff ?? homeFeatures.offensePpa),
    ppaDef: num(homeFeatures.ppaDef ?? homeFeatures.defensePpa),
    gamesPlayed: homeGp.gamesPlayed,
    gamesPlayedSource: homeGp.source,
  });
  const awayAudit = auditTeamFeatureUsage({
    ...awayFeatures,
    ppaOff: num(awayFeatures.ppaOff ?? awayFeatures.offensePpa),
    ppaDef: num(awayFeatures.ppaDef ?? awayFeatures.defensePpa),
    gamesPlayed: awayGp.gamesPlayed,
    gamesPlayedSource: awayGp.source,
  });

  const provenance = buildScoringProvenance({
    homeFeatures: {
      ppaOff: homeAudit.available.ppaOff,
      ppaDef: homeAudit.available.ppaDef,
      gamesPlayed: homeGp.gamesPlayed,
      gamesPlayedSource: homeGp.source,
      priorOff: num(homeFeatures.priorOff),
      priorDef: num(homeFeatures.priorDef),
      offensiveSuccessRate: num(homeFeatures.offensiveSuccessRate),
      coreOffense: num(homeFeatures.coreOffense),
    },
    awayFeatures: {
      ppaOff: awayAudit.available.ppaOff,
      ppaDef: awayAudit.available.ppaDef,
      gamesPlayed: awayGp.gamesPlayed,
      gamesPlayedSource: awayGp.source,
      priorOff: num(awayFeatures.priorOff),
      priorDef: num(awayFeatures.priorDef),
      coreOffense: num(awayFeatures.coreOffense),
    },
    homeTeamId: game.homeEspnId || homeFeatures.canonicalId,
    awayTeamId: game.awayEspnId || awayFeatures.canonicalId,
    season: game.season || 2026,
    throughWeek: throughWeek ?? num(homeFeatures.coreThroughWeek) ?? num(awayFeatures.coreThroughWeek),
    ingestionBatchId: collectionBatchId,
  });

  const matchups = buildGameMatchupFeatures({
    home: {
      passEpa: homeFeatures.ppaPass,
      rushEpa: homeFeatures.ppaRush,
      passEpaAllowed: homeFeatures.ppaPassAllowed,
      rushEpaAllowed: homeFeatures.ppaRushAllowed,
      successRate: homeFeatures.offensiveSuccessRate,
      successRateAllowed: homeFeatures.defensiveSuccessRate,
      explosiveRate: homeFeatures.offensiveExplosiveness,
      explosiveRateAllowed: homeFeatures.defensiveExplosiveness,
      lineYards: homeFeatures.offensiveLineYards,
      lineYardsAllowed: homeFeatures.defensiveLineYards,
      havocRate: homeFeatures.defensiveHavoc,
      havocAllowed: homeFeatures.offensiveHavoc,
      pointsPerOpportunity: homeFeatures.offensivePointsPerOpportunity,
      pointsPerOpportunityAllowed: homeFeatures.defensivePointsPerOpportunity,
      coreOffense: homeFeatures.coreOffense,
      coreDefense: homeFeatures.coreDefense,
    },
    away: {
      passEpa: awayFeatures.ppaPass,
      rushEpa: awayFeatures.ppaRush,
      passEpaAllowed: awayFeatures.ppaPassAllowed,
      rushEpaAllowed: awayFeatures.ppaRushAllowed,
      successRate: awayFeatures.offensiveSuccessRate,
      successRateAllowed: awayFeatures.defensiveSuccessRate,
      explosiveRate: awayFeatures.offensiveExplosiveness,
      explosiveRateAllowed: awayFeatures.defensiveExplosiveness,
      lineYards: awayFeatures.offensiveLineYards,
      lineYardsAllowed: awayFeatures.defensiveLineYards,
      havocRate: awayFeatures.defensiveHavoc,
      havocAllowed: awayFeatures.offensiveHavoc,
      pointsPerOpportunity: awayFeatures.offensivePointsPerOpportunity,
      pointsPerOpportunityAllowed: awayFeatures.defensivePointsPerOpportunity,
      coreOffense: awayFeatures.coreOffense,
      coreDefense: awayFeatures.coreDefense,
    },
    throughWeek: provenance.throughWeek,
  });

  const excluded = [
    ...homeAudit.presentButUnusedByChampion.map((f) => ({
      side: "home",
      feature: f,
      reason: "zero fitted AA coefficient — display/research only",
      level: assignFeatureLevel(f),
    })),
    ...awayAudit.presentButUnusedByChampion.map((f) => ({
      side: "away",
      feature: f,
      reason: "zero fitted AA coefficient — display/research only",
      level: assignFeatureLevel(f),
    })),
  ];

  const priorFallbacks = [];
  if (homeGp.source === "coreThroughWeekFallback") {
    priorFallbacks.push({ side: "home", type: "gamesPlayed", source: homeGp.source, note: homeGp.note });
  }
  if (awayGp.source === "coreThroughWeekFallback") {
    priorFallbacks.push({ side: "away", type: "gamesPlayed", source: awayGp.source, note: awayGp.note });
  }
  if (!(homeGp.gamesPlayed > 0) && num(homeFeatures.priorOff) != null) {
    priorFallbacks.push({ side: "home", type: "prior_only_blend_risk", source: "prior-v1" });
  }
  if (!(awayGp.gamesPlayed > 0) && num(awayFeatures.priorOff) != null) {
    priorFallbacks.push({ side: "away", type: "prior_only_blend_risk", source: "prior-v1" });
  }

  return {
    version: SOURCE_MODEL_AUDIT_VERSION,
    gameId: game.id || game.game_id || null,
    matchup: `${game.away_name || game.away || "away"} @ ${game.home_name || game.home || "home"}`,
    kickoff: game.start || game.kickoff || null,
    answers: {
      cfbdDatasetsAvailable: summarizeCfbdRegistry(),
      sdvDatasetsAvailable: summarizeSdvRegistry(),
      eligibleThroughWeek: provenance.throughWeek,
      collected: {
        homePpa: homeAudit.available.ppaOff != null,
        awayPpa: awayAudit.available.ppaOff != null,
        homeGamesPlayed: homeGp.gamesPlayed,
        awayGamesPlayed: awayGp.gamesPlayed,
      },
      archived,
      normalized: true,
      identities: {
        home: game.homeEspnId || homeFeatures.canonicalId || homeFeatures.team,
        away: game.awayEspnId || awayFeatures.canonicalId || awayFeatures.team,
      },
      championFeatures: provenance.home.consumed,
      challengerEntry: challengerIds,
      coreResearch: {
        eligible: coreResearchEligible,
        homeCore: num(homeFeatures.coreOffense) != null && num(homeFeatures.coreDefense) != null,
        awayCore: num(awayFeatures.coreOffense) != null && num(awayFeatures.coreDefense) != null,
        matchupResearchOnly: true,
      },
      excluded,
      valueAge: {
        homeAsOf: homeFeatures.snapshotAsOf || homeFeatures.as_of || null,
        awayAsOf: awayFeatures.snapshotAsOf || awayFeatures.as_of || null,
      },
      priorFallbacks,
      predictedScore: projection
        ? { home: projection.home, away: projection.away, margin: projection.margin, modelId: projection.modelId }
        : null,
      reproducibleFromFrozen: Boolean(projection?.ok && provenance.ok),
    },
    sdvAvailable,
    featureLevelsInPlay: {
      L1: FEATURE_LEVEL.L1_CORE_PRODUCTION,
      L2_matchup_research: matchups,
      L3_live: "not_for_pregame",
    },
    provenance,
    note: "Page-visible advanced stats ≠ champion influence. CORE/SDV remain research until authorized.",
  };
}
