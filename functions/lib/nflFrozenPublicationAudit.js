import { replayNflProScore } from "./nflScoreReplayAudit.js";
import {
  NFL_PRODUCTION_CHAMPION,
  NFL_DISPLAYED_RESEARCH,
  NFL_QB_PERSONNEL_CHALLENGER,
} from "./nflModelGovernance.js";

/**
 * Forward-only pregame audit attachment. No reconstructed historical rows.
 * This packet is diagnostic evidence and never qualifies a model or wager.
 *
 * Required immutable score record fields (Phase 3):
 * game identity, kickoff, model version, code SHA, publication time, input
 * timestamps, scoring contributions, missing-feature flags, uncertainty,
 * final scores/margin/total/probability, and reconciliation status.
 */

function finite(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function contributionSide(row = {}, base = null) {
  const matchup = row.matchup || {};
  return {
    baseline: finite(base),
    teamPower: finite(row.teamPower),
    passMatchup: finite(matchup.pass),
    rushMatchup: finite(matchup.rush),
    explosiveMatchup: finite(matchup.explosive),
    pressureMatchup: finite(matchup.pressure),
    trenchesMatchup: finite(matchup.trenches),
    matchupTotal: finite(matchup.total),
    qbContribution: finite(row.qb?.value) == null ? null : Number((row.qb.value * 0.55).toFixed(6)),
    qbRawIndex: finite(row.qb?.value),
    qbInputs: row.qb?.inputs || null,
    trackingContribution: finite(row.tracking?.value),
    trackingInputs: row.tracking?.inputs || null,
    specialTeams: finite(row.specialTeams),
    context: finite(row.context),
    homeField: finite(row.hfa),
    researchDiagnosticsOnly: {
      note: "Directional unit matchups on the card are research-display-only and are not summed into this score.",
    },
  };
}

export function buildNflFrozenAuditPacket(game = {}, slate = {}, opts = {}) {
  const shadow = game.nflProShadow;
  if (!shadow?.ok || !shadow.decomposition) {
    return {
      schema: "nfl-frozen-score-audit-v1",
      ok: false,
      reason: "model-decomposition-unavailable",
      canQualify: false,
      canAuthorizeWager: false,
      reconstructability: "NOT_FULLY_RECONSTRUCTABLE",
    };
  }
  const replay = replayNflProScore(shadow);
  if (!replay.ok || !replay.reconciled) {
    return {
      schema: "nfl-frozen-score-audit-v1",
      ok: false,
      reason: replay.reason,
      replay,
      canQualify: false,
      canAuthorizeWager: false,
      reconstructability: "ARITHMETIC_MISMATCH",
    };
  }
  const scoreHome = game.model?.projHome ?? game.projHomeScore ?? game.projHome ?? null;
  const scoreAway = game.model?.projAway ?? game.projAwayScore ?? game.projAway ?? null;
  const displayedScoreMatches =
    typeof scoreHome === "number" &&
    typeof scoreAway === "number" &&
    Math.abs(scoreHome - shadow.home) <= 0.11 &&
    Math.abs(scoreAway - shadow.away) <= 0.11;
  const pitInput = game.nflFeatures;
  const hasInput =
    pitInput && Object.keys(pitInput.home || {}).length && Object.keys(pitInput.away || {}).length;
  const profile = game.nflPersistentProfile || null;
  const availabilityAttachedBeforeScore = Boolean(profile?.attachedBeforeScoring);
  const qbShadow = game.nflQbPersonnelShadow || game.challengers?.[NFL_QB_PERSONNEL_CHALLENGER.modelId] || null;
  const publishedAt = opts.publishedAt || new Date().toISOString();
  const codeSha =
    opts.codeSha ||
    slate?.build?.commitSha ||
    slate?.deploymentCommit ||
    null;

  const contributions = {
    home: contributionSide(shadow.decomposition.home, shadow.decomposition.baseLeaguePpg),
    away: contributionSide(shadow.decomposition.away, shadow.decomposition.baseLeaguePpg),
    weatherTotalFactor: finite(shadow.weatherTotalFactor) ?? 1,
    scoringUsesVerifiedAvailability: false,
    availabilityStateAttached: Boolean(profile?.configured),
    availabilityAttachedBeforeScore,
  };

  const missingFeatures = shadow.coverage?.missing || [];
  const reconstructability =
    displayedScoreMatches && hasInput && replay.reconciled
      ? "ARITHMETICALLY_RECONCILED_INPUTS_ATTACHED"
      : !hasInput
        ? "NOT_FULLY_RECONSTRUCTABLE"
        : !displayedScoreMatches
          ? "DISPLAY_MISMATCH"
          : "PARTIAL";

  return {
    schema: "nfl-frozen-score-audit-v1",
    ok: Boolean(displayedScoreMatches && hasInput && replay.reconciled),
    reason: !displayedScoreMatches
      ? "displayed-score-diverges-from-shadow"
      : !hasInput
        ? "frozen-feature-inputs-unavailable"
        : null,
    reconstructability,
    gameId: game.id || null,
    teams: {
      away: game.away?.abbr || null,
      home: game.home?.abbr || null,
      awayName: game.away?.fullName || game.away?.name || null,
      homeName: game.home?.fullName || game.home?.name || null,
    },
    kickoff: game.start || null,
    venue: game.venue || null,
    neutralSite: Boolean(game.neutral || game.neutralSite),
    modelId: shadow.modelId,
    modelVersion: shadow.version,
    productionChampion: NFL_PRODUCTION_CHAMPION.modelId,
    displayedResearchModel: `${NFL_DISPLAYED_RESEARCH.modelId}@${shadow.version || NFL_DISPLAYED_RESEARCH.version}`,
    codeSha,
    publicationTime: publishedAt,
    inputTimestamps: {
      nflVerseBuiltAt: slate?.research?.nflVerse?.builtAt || slate?.research?.nflVerse?.asOf || null,
      featureSource: pitInput?.home?.source || pitInput?.away?.source || null,
      trackingSource: pitInput?.home?.trackingSource || pitInput?.away?.trackingSource || null,
      profileHomeUpdatedAt: profile?.home?.updated_at || profile?.home?.updatedAt || null,
      profileAwayUpdatedAt: profile?.away?.updated_at || profile?.away?.updatedAt || null,
    },
    projection: {
      home: shadow.home,
      away: shadow.away,
      total: shadow.total,
      margin: shadow.margin,
      pHomeWin: finite(shadow.pHomeWin),
      sigmaMargin: finite(shadow.sigmaMargin),
      sigmaTotal: finite(shadow.sigmaTotal),
    },
    contributions,
    missingFeatureFlags: missingFeatures,
    coverage: shadow.coverage || null,
    uncertainty: {
      sigmaMargin: finite(shadow.sigmaMargin),
      sigmaTotal: finite(shadow.sigmaTotal),
      coverageShare: finite(shadow.coverage?.share),
      fallbackBehavior: missingFeatures.length
        ? "missing advanced features remain null; weightedPresent skips absent terms; no imputed advanced stats"
        : "full feature coverage",
    },
    probabilityDistribution: {
      family: "normal-margin",
      pHomeWin: finite(shadow.pHomeWin),
      sigmaMargin: finite(shadow.sigmaMargin),
      provenance: "HEURISTIC_SIGMA",
      validationStatus: "RESEARCH",
    },
    personnelState: {
      attached: Boolean(profile?.configured),
      attachedBeforeScoring: availabilityAttachedBeforeScore,
      consumedByDisplayedScore: false,
      qbPersonnelShadow: qbShadow?.ok
        ? {
            modelId: qbShadow.modelId,
            gateFired: Boolean(qbShadow.gate?.fired),
            combinedQbBurden: qbShadow.gate?.combinedQbBurden ?? null,
            marginCorrection: qbShadow.marginCorrection ?? 0,
            lifecycle: qbShadow.lifecycle || "SHADOW",
            canQualify: false,
            canAuthorizeWager: false,
          }
        : null,
    },
    internationalContext: game.nflInternationalContext || game.internationalContext || null,
    replay,
    publishedScoreMatches: displayedScoreMatches,
    inputSnapshot: hasInput ? structuredClone(pitInput) : null,
    inputStatus: hasInput ? "attached-at-publication" : "unavailable",
    feedMetadata: slate.research?.nflVerse || null,
    pitVerified: false,
    canQualify: false,
    canAuthorizeWager: false,
    note: "Arithmetic reconciliation is not proof of pregame input provenance; verify immutable PIT record separately. Displayed research score does not consume verified injuries.",
  };
}

/**
 * Attach audit packets to live board games for operator visibility.
 * Does not write D1; publish endpoint remains the immutable store path.
 */
export function attachNflFrozenAuditPackets(games = [], slate = {}) {
  return (games || []).map((game) => {
    if (game.sport && game.sport !== "nfl") return game;
    const packet = buildNflFrozenAuditPacket(game, slate);
    return {
      ...game,
      nflFrozenAudit: packet,
      scoreReconciled: Boolean(packet.ok && packet.replay?.reconciled),
      scoreReconstructability: packet.reconstructability || null,
    };
  });
}
