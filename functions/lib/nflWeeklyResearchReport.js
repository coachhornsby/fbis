/**
 * Weekly NFL research report builder.
 * Generates hypotheses and shadow evidence summaries.
 * NEVER changes production champion, coefficients, confidence authority,
 * qualification rules, or wagering permissions.
 *
 * Unavailable metrics are null — never zero-filled as if measured.
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

function aggregateFeatureFamilies(games = []) {
  const availableCounts = {};
  const missingCounts = {};
  for (const g of games) {
    for (const f of g.nflProShadow?.coverage?.available || []) {
      availableCounts[f] = (availableCounts[f] || 0) + 1;
    }
    for (const f of g.nflProShadow?.coverage?.missing || []) {
      missingCounts[f] = (missingCounts[f] || 0) + 1;
    }
  }
  const families = [...new Set([...Object.keys(availableCounts), ...Object.keys(missingCounts)])].sort();
  return {
    families,
    availableCounts,
    missingCounts,
    byFamily: Object.fromEntries(
      families.map((f) => [
        f,
        {
          presentGames: availableCounts[f] || 0,
          missingGames: missingCounts[f] || 0,
          slateShare: games.length ? (availableCounts[f] || 0) / games.length : null,
        },
      ])
    ),
  };
}

/** Families wired into NFL-PRO score math when non-null (not an accuracy claim). */
const SCORE_FUNCTION_FAMILIES = Object.freeze([
  "teamEpa", "success", "earlyDown", "quarterback", "passMatchup", "rushMatchup",
  "explosives", "pressure", "trenches", "specialTeams", "nextGenTracking", "context",
]);

/**
 * Separate three claims that must not be conflated:
 * 1) availability — snapshot field presence / coverage flags
 * 2) scoreContribution — whether non-null values enter the displayed research score
 * 3) accuracyEvidence — chronological OOS ablation (null until measured)
 */
export function buildFeatureImpactLayers(games = [], featureFamilies = null) {
  const fam = featureFamilies || aggregateFeatureFamilies(games);
  const consumedNonNull = {};
  const shares = [];
  for (const g of games) {
    const cov = g.nflProShadow?.coverage || {};
    const share = finite(cov.share);
    if (share != null) shares.push(share);
    for (const f of cov.available || []) {
      consumedNonNull[f] = (consumedNonNull[f] || 0) + 1;
    }
  }
  const newlyEnriched = ["success", "earlyDown", "explosives"];
  return {
    schema: "nfl-feature-impact-layers-v1",
    availability: {
      avgShare: shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null,
      nWithCoverage: shares.length,
      families: fam.byFamily,
      stillMissing: Object.keys(fam.missingCounts).sort(),
      note: "Snapshot / coverage completeness only. Does not prove score impact or accuracy lift.",
    },
    scoreContribution: {
      familiesInScoreFunction: SCORE_FUNCTION_FAMILIES,
      currentlyNonNullAndConsumed: Object.keys(consumedNonNull).sort(),
      newlyEnrichedFamiliesInScoreFunction: newlyEnriched,
      altersDisplayedResearchScoreWhenPresent: true,
      note: "When non-null, success/earlyDown/explosives enter NFL-PRO-v1@v1.2 matchup/team terms. That is wiring, not a validated accuracy improvement.",
    },
    accuracyEvidence: {
      status: "NOT_MEASURED",
      requiredDesign: "chronological OOS ablation of each family vs v1.1 baseline and closing market on identical windows (n pinned)",
      ablationMarginMaeDelta: null,
      sampleN: null,
      promotionEvidencePass: false,
      note: "Data completeness is foundation only. Market margin MAE gap (v1.1 10.1993 vs close 9.8543, n=2176) is the scientific target.",
    },
  };
}

function qbShadowSummary(games = []) {
  const ok = games.filter((g) => g.nflQbPersonnelShadow?.ok).length;
  const fired = games.filter((g) => g.nflQbPersonnelShadow?.gate?.fired).length;
  const gates = games
    .map((g) => g.nflQbPersonnelShadow?.gate)
    .filter(Boolean);
  const prospectivePassed = gates.find((g) => g.prospectiveValidationPassed != null)?.prospectiveValidationPassed ?? null;
  const historicalPassed = gates.find((g) => g.historicalValidationPassed != null)?.historicalValidationPassed ?? null;
  const operatorApproved = gates.find((g) => g.operatorApprovedForProduction != null)?.operatorApprovedForProduction ?? null;
  return {
    modelId: NFL_QB_PERSONNEL_CHALLENGER.modelId,
    lifecycle: "SHADOW",
    gamesOk: ok,
    gateFired: fired,
    historicalValidationPassed: historicalPassed,
    prospectiveValidationPassed: prospectivePassed,
    operatorApprovedForProduction: operatorApproved,
    altersDisplayedBoardScore: false,
    canQualify: false,
    canAuthorizeWager: false,
    promotionEligible: false,
  };
}

export function buildNflWeeklyResearchReport({
  generatedAt = new Date().toISOString(),
  slate = null,
  researchStatus = null,
  publishedRows = [],
  publicationCoverage = null,
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
  const featureFamilies = aggregateFeatureFamilies(games);
  const missingFeatureCounts = featureFamilies.missingCounts;
  const qbSummary = qbShadowSummary(games);
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

  const featureImpact = buildFeatureImpactLayers(games, featureFamilies);

  const hypotheses = [];
  if (avgCoverage != null && avgCoverage < 1) {
    hypotheses.push({
      id: "H-FEATURE-AVAILABILITY",
      claim: "Some feature families remain null on the live slate (availability gap). Availability is not an accuracy claim.",
      evidence: {
        avgCoverage,
        missingFeatureCounts,
        presentFamilies: Object.keys(featureFamilies.availableCounts),
        accuracyEvidenceStatus: featureImpact.accuracyEvidence.status,
      },
      status: "OPEN",
      autoPromote: false,
    });
  }
  hypotheses.push({
    id: "H-FEATURE-ACCURACY-UNMEASURED",
    claim: "Enriched PBP families may enter the displayed research score when non-null, but chronological OOS ablation vs market has not established accuracy improvement.",
    evidence: {
      scoreContribution: featureImpact.scoreContribution,
      accuracyEvidence: featureImpact.accuracyEvidence,
      marketGap: { v11MarginMae: 10.1993, closingMarginMae: 9.8543, n: 2176 },
    },
    status: "OPEN",
    autoPromote: false,
  });
  if (withQbShadow > 0) {
    hypotheses.push({
      id: "H-QB-AVAILABILITY-SHADOW",
      claim: "Verified QB/personnel state is attached before scoring for SHADOW use only; displayed research score ignores the overlay until prospective gates pass.",
      evidence: {
        withQbShadow,
        gateFired,
        historicalValidationPassed: qbSummary.historicalValidationPassed,
        prospectiveValidationPassed: qbSummary.prospectiveValidationPassed,
        operatorApprovedForProduction: qbSummary.operatorApprovedForProduction,
      },
      status: gateFired > 0 ? "SHADOW_ACTIVE" : "SHADOW_ATTACHED",
      autoPromote: false,
    });
  }
  const currentCoverage = finite(publicationCoverage?.currentCoverageShare);
  if (currentCoverage != null && currentCoverage < 1) {
    hypotheses.push({
      id: "H-PUBLICATION-COVERAGE",
      claim: "Not every currently eligible NFL game has an immutable research publication for the active checkpoint.",
      evidence: {
        legacyPublishedProjections: publishedRows?.length || 0,
        currentEligible: publicationCoverage?.currentEligible ?? null,
        currentFrozen: publicationCoverage?.currentFrozen ?? null,
        currentCoverageShare: currentCoverage,
        missingCheckpointCount: publicationCoverage?.missingCheckpointCount ?? null,
      },
      status: "DEGRADED",
      autoPromote: false,
    });
  } else if (!publicationCoverage && (publishedRows?.length || 0) < games.length) {
    hypotheses.push({
      id: "H-PUBLICATION-COVERAGE",
      claim: "Not every scheduled game has an immutable published_projections freeze for the current slate date.",
      evidence: { published: publishedRows?.length || 0, scheduled: games.length },
      status: "DEGRADED",
      autoPromote: false,
    });
  }

  return {
    schema: "nfl-weekly-research-report-v3",
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
      unauthorizedPromotionForbidden: true,
    },
    systemHealth: {
      date: slate?.date || null,
      scheduledGames: games.length,
      modeledGames: games.filter((g) => g.nflProShadow?.ok).length,
      publishedCurrentCheckpoint: publicationCoverage?.currentFrozen ?? null,
      publicationCoverageShare: currentCoverage,
      missingHistoricalCheckpoints: publicationCoverage?.missingCheckpointCount ?? null,
      blockedPublications: publicationCoverage?.blockedCount ?? null,
      reconciledScores: reconciled,
      auditedOk: withAudit,
      avgFeatureCoverage: avgCoverage,
      injuryStateFreshness: profileSummary?.freshness || null,
      marketCoverage: null,
      settlementCompleteness: economicSummary?.settlementCompleteness ?? null,
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
    featureCoverage: {
      avgShare: avgCoverage,
      nWithCoverage: coverageShares.length,
      families: featureFamilies.byFamily,
      stillMissing: Object.keys(missingFeatureCounts).sort(),
      note: "Availability only. Missing families remain null — not imputed. See featureImpact for score vs accuracy layers.",
    },
    featureImpact,
    publication: {
      legacyPublishedProjections: publishedRows?.length || 0,
      legacyCoverageShare: games.length ? (publishedRows?.length || 0) / games.length : null,
      researchCheckpoints: publicationCoverage
        ? {
            currentEligible: publicationCoverage.currentEligible,
            currentFrozen: publicationCoverage.currentFrozen,
            currentCoverageShare: publicationCoverage.currentCoverageShare,
            missingCheckpointCount: publicationCoverage.missingCheckpointCount,
            blockedCount: publicationCoverage.blockedCount,
            missingPolicy: publicationCoverage.missingPolicy || "NEVER_RETROACTIVELY_INVENT",
          }
        : null,
    },
    scoreAuditStandard: {
      arithmeticReconciliation: "ARITHMETICALLY_RECONCILED_INPUTS_ATTACHED",
      independentSourceReplay: "independentSourceReplay.status on nfl-frozen-score-audit-v2",
      note: "Arithmetic OK does not imply independent raw-source replay PASS.",
    },
    predictivePerformance: {
      marginMae: null,
      totalMae: null,
      winnerAccuracy: null,
      calibration: null,
      sample: null,
      note: "Prospective metrics unavailable until graded research publications settle. Challenger compare is separate (identical chronological windows).",
    },
    challengerComparePinned: {
      path: "research/nfl/challenger-compare-20261018.json",
      n: 2176,
      identicalChronologicalWindows: true,
      promotionEvidencePass: false,
      v11MarginMae: 10.1993,
      closingMarginMae: 9.8543,
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
    qbShadow: qbSummary,
    qbProspective: researchStatus?.promotionGate || researchStatus?.qbShadow || null,
    economic: economicSummary || {
      note: "Pass economicSummary from tracker reconcile; null fields mean unavailable, not zero.",
      modelAuthorizedWagers: false,
      spreads: null,
      totals: null,
      moneylines: null,
      playerProps: null,
      roi: null,
      clv: null,
    },
    hypotheses,
    challengerProposals: [
      {
        modelId: NFL_QB_PERSONNEL_CHALLENGER.modelId,
        evidenceRequired: "prospective gate thresholds in NFL-QB-PROSPECTIVE-GATE-v1",
        promotionEligible: false,
        operatorApprovalRequired: true,
      },
    ],
    productionIssues: {
      missingFeatureFamilies: Object.keys(missingFeatureCounts).sort(),
      failedPublications: publicationCoverage?.blockedCount ?? null,
      storagePressure: null,
      unexpectedProjectionChanges: null,
    },
    invariants: {
      researchMayGenerateHypotheses: true,
      researchMayNotChangeChampion: true,
      researchMayNotChangeWagerAuthority: true,
    },
  };
}
