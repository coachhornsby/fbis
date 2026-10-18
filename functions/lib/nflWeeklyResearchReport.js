/**
 * Weekly NFL research report builder.
 * Generates hypotheses and shadow evidence summaries.
 * NEVER changes production champion, coefficients, confidence authority,
 * qualification rules, or wagering permissions.
 */

import {
  NFL_PRODUCTION_CHAMPION,
  NFL_DISPLAYED_RESEARCH,
  NFL_QB_PERSONNEL_CHALLENGER,
  NFL_PLAYER_PROP_RESEARCH,
} from "./nflModelGovernance.js";

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildNflWeeklyResearchReport({
  generatedAt = new Date().toISOString(),
  slate = null,
  researchStatus = null,
  publishedRows = [],
  profileSummary = null,
  acquisitionHealth = null,
  economicSummary = null,
  codeSha = null,
} = {}) {
  const games = slate?.games || [];
  const reconciled = games.filter((g) => g.scoreReconciled).length;
  const withAudit = games.filter((g) => g.nflFrozenAudit?.ok).length;
  const withQbShadow = games.filter((g) => g.nflQbPersonnelShadow?.ok).length;
  const gateFired = games.filter((g) => g.nflQbPersonnelShadow?.gate?.fired).length;
  const coverageShares = games
    .map((g) => finite(g.nflProShadow?.coverage?.share))
    .filter((v) => v != null);
  const avgCoverage = coverageShares.length
    ? coverageShares.reduce((a, b) => a + b, 0) / coverageShares.length
    : null;
  const missingFeatureCounts = {};
  for (const g of games) {
    for (const f of g.nflProShadow?.coverage?.missing || []) {
      missingFeatureCounts[f] = (missingFeatureCounts[f] || 0) + 1;
    }
  }
  const modelDisagreements = games
    .map((g) => ({
      id: g.id,
      matchup: `${g.away?.abbr}@${g.home?.abbr}`,
      side: finite(g.modelDisagreement?.side),
      total: finite(g.modelDisagreement?.total),
      fbisMargin: finite(g.projMargin ?? g.nflProShadow?.margin),
      fbisTotal: finite(g.projTotal ?? g.nflProShadow?.total),
    }))
    .filter((r) => r.side != null || r.total != null);

  const hypotheses = [];
  if (avgCoverage != null && avgCoverage < 0.6) {
    hypotheses.push({
      id: "H-FEATURE-COVERAGE",
      claim: "Missing success/early-down/pressure/trenches/special-teams features may compress or inflate research scores relative to market.",
      evidence: { avgCoverage, missingFeatureCounts },
      status: "OPEN",
      autoPromote: false,
    });
  }
  if (gateFired > 0) {
    hypotheses.push({
      id: "H-QB-AVAILABILITY-SHADOW",
      claim: "Verified QB/personnel burden changes projected margin on gated games without altering the displayed research score.",
      evidence: { withQbShadow, gateFired },
      status: "SHADOW_ACTIVE",
      autoPromote: false,
    });
  }
  if ((publishedRows?.length || 0) < games.length) {
    hypotheses.push({
      id: "H-PUBLICATION-COVERAGE",
      claim: "Not every scheduled game has an immutable published_projections freeze for the current slate date.",
      evidence: { published: publishedRows?.length || 0, scheduled: games.length },
      status: "DEGRADED",
      autoPromote: false,
    });
  }

  return {
    schema: "nfl-weekly-research-report-v1",
    generatedAt,
    codeSha,
    governance: {
      productionChampion: NFL_PRODUCTION_CHAMPION.modelId,
      displayedResearchModel: `${NFL_DISPLAYED_RESEARCH.modelId}@${NFL_DISPLAYED_RESEARCH.version}`,
      qbPersonnelChallenger: NFL_QB_PERSONNEL_CHALLENGER.modelId,
      playerPropModel: NFL_PLAYER_PROP_RESEARCH.modelId,
      automaticPromotion: false,
      wagerAuthorityChanged: false,
      coefficientsChanged: false,
      qualificationRulesChanged: false,
    },
    slate: {
      date: slate?.date || null,
      scheduledGames: games.length,
      reconciledScores: reconciled,
      auditedOk: withAudit,
      qbShadowOk: withQbShadow,
      qbGateFired: gateFired,
      avgFeatureCoverage: avgCoverage,
      missingFeatureCounts,
    },
    publication: {
      immutableRows: publishedRows?.length || 0,
      coverageShare: games.length ? (publishedRows?.length || 0) / games.length : null,
    },
    dataHealth: {
      profiles: profileSummary || null,
      acquisition: acquisitionHealth
        ? {
            status: acquisitionHealth.status || null,
            prizepicks: acquisitionHealth.sourceStates?.find((s) => s.source === "prizepicks") || null,
            action: acquisitionHealth.sourceStates?.find((s) => s.source === "action") || null,
          }
        : null,
      nflVerse: slate?.research?.nflVerse || null,
    },
    modelDisagreements,
    qbProspective: researchStatus?.promotionGate || researchStatus?.qbShadow || null,
    economic: economicSummary || null,
    hypotheses,
    challengerProposals: [
      {
        modelId: NFL_QB_PERSONNEL_CHALLENGER.modelId,
        evidenceRequired: "prospective gate thresholds in NFL-QB-PROSPECTIVE-GATE-v1",
        promotionEligible: false,
        operatorApprovalRequired: true,
      },
    ],
    invariants: {
      researchMayGenerateHypotheses: true,
      researchMayNotChangeChampion: true,
      researchMayNotChangeWagerAuthority: true,
    },
  };
}
