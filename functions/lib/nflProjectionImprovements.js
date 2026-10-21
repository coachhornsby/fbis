/**
 * NFL research-only projection improvements (P0–P2 bundle).
 *
 * Applies fitted score residuals + Platt calibration to displayed NFL-PRO-v1.2
 * research scores. Champion NFL-PRO-v1.1 and wager gates remain frozen.
 *
 * Lifecycle: RESEARCH_CORRECTIONS. Never promotes. Never authorizes wagers.
 */

import correctionsArtifact from "./nflProV12ResearchCorrections.js";
import { clamp, finite, round1 } from "./deepModelCommon.js";
import { pGreater } from "./metrics.js";
import {
  NFL_PRODUCTION_CHAMPION,
  NFL_DISPLAYED_RESEARCH,
} from "./nflModelGovernance.js";

/** Mirror of NFL_PRO_CONSTANTS.marginSigma — avoid circular import with nflProModel. */
const DEFAULT_MARGIN_SIGMA = 13.8;

export const NFL_RESEARCH_CORRECTIONS_SCHEMA = "nfl-pro-v1-2-research-corrections-v1";
export const NFL_RESEARCH_CORRECTIONS_LIFECYCLE = "RESEARCH_CORRECTIONS";

const DEFAULT_CAPS = Object.freeze({
  marginResidualAbs: 3.5,
  totalResidualAbs: 4.0,
});

function clampP(p) {
  const x = Number(p);
  if (!Number.isFinite(x)) return 0.5;
  return Math.min(1 - 1e-6, Math.max(1e-6, x));
}

function logit(p) {
  const q = clampP(p);
  return Math.log(q / (1 - q));
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));
}

export function loadNflResearchCorrections(artifact = correctionsArtifact) {
  return artifact && typeof artifact === "object" ? artifact : correctionsArtifact;
}

export function cappedResiduals(artifact = correctionsArtifact) {
  const caps = { ...DEFAULT_CAPS, ...(artifact?.caps || {}) };
  const rawMargin = finite(artifact?.scoreResiduals?.marginResidual) ?? 0;
  const rawTotal = finite(artifact?.scoreResiduals?.totalResidual) ?? 0;
  return {
    marginResidual: clamp(rawMargin, -caps.marginResidualAbs, caps.marginResidualAbs),
    totalResidual: clamp(rawTotal, -caps.totalResidualAbs, caps.totalResidualAbs),
    caps,
  };
}

/** Platt: sigmoid(intercept + weight * logit(p)). */
export function applyPlattCalibration(p, platt = correctionsArtifact.platt) {
  const intercept = finite(platt?.intercept);
  const weight = finite(platt?.weight);
  if (intercept == null || weight == null) return clampP(p);
  return clampP(sigmoid(intercept + weight * logit(p)));
}

/**
 * Apply margin/total residuals then recompute win probability + Platt.
 * Does not mutate champion coefficients. Tags RESEARCH_CORRECTIONS lifecycle.
 */
export function applyResearchScoreCorrections(projection = {}, opts = {}) {
  if (!projection?.ok) return projection;
  const artifact = loadNflResearchCorrections(opts.artifact);
  if (artifact?.altersChampion) {
    throw new Error("research-corrections-must-not-alter-champion");
  }
  if (projection.researchCorrections?.applied) return projection;

  const { marginResidual, totalResidual, caps } = cappedResiduals(artifact);
  const before = {
    home: finite(projection.home),
    away: finite(projection.away),
    margin: finite(projection.margin),
    total: finite(projection.total),
    pHomeWin: finite(projection.pHomeWin),
  };
  if (before.home == null || before.away == null) return projection;

  // marginResidual is added to projected margin (negative shrinks home edge).
  // Split ±half across sides; totalResidual lifts both sides equally.
  const homeAdj = before.home + marginResidual / 2 + totalResidual / 2;
  const awayAdj = before.away - marginResidual / 2 + totalResidual / 2;
  const home = round1(clamp(homeAdj, 8, 42));
  const away = round1(clamp(awayAdj, 8, 42));
  const margin = round1(home - away);
  const total = round1(home + away);
  const sigma =
    finite(projection.sigmaMargin) ??
    DEFAULT_MARGIN_SIGMA *
      (1 + (1 - (finite(projection.coverage?.share) ?? 1)) * 0.28);
  const pHomeWinRaw = pGreater(margin, 0, sigma);
  const pHomeWinCalibrated = applyPlattCalibration(pHomeWinRaw, artifact.platt);

  return {
    ...projection,
    home,
    away,
    margin,
    total,
    pHomeWin: pHomeWinCalibrated,
    pHomeWinRaw,
    pHomeWinCalibrated,
    researchCorrections: {
      applied: true,
      schema: artifact.schema || NFL_RESEARCH_CORRECTIONS_SCHEMA,
      lifecycle: NFL_RESEARCH_CORRECTIONS_LIFECYCLE,
      fittedAt: artifact.fittedAt || null,
      before,
      residuals: { marginResidual, totalResidual, caps },
      platt: {
        method: artifact.platt?.method || "platt",
        intercept: artifact.platt?.intercept ?? null,
        weight: artifact.platt?.weight ?? null,
      },
      championUnchanged: artifact.championUnchanged || NFL_PRODUCTION_CHAMPION.modelId,
      altersChampion: false,
      canAuthorizeWager: false,
      targetVersion: artifact.targetModel?.version || NFL_DISPLAYED_RESEARCH.version,
    },
  };
}

/**
 * Apply the same residual/Platt transform to a reconstructed base score
 * (used by audit replay so corrected publications still reconcile).
 */
export function applyResearchCorrectionsToScores(scores = {}, projection = {}) {
  const rc = projection?.researchCorrections;
  if (!rc?.applied) return scores;
  const marginResidual = finite(rc.residuals?.marginResidual) ?? 0;
  const totalResidual = finite(rc.residuals?.totalResidual) ?? 0;
  const homeAdj = scores.home + marginResidual / 2 + totalResidual / 2;
  const awayAdj = scores.away - marginResidual / 2 + totalResidual / 2;
  const home = round1(clamp(homeAdj, 8, 42));
  const away = round1(clamp(awayAdj, 8, 42));
  return {
    home,
    away,
    margin: round1(home - away),
    total: round1(home + away),
  };
}

/**
 * Market-relative promotion gate. Research evidence only — never mutates champion.
 * Requires identical-window OOS to beat closing market on all configured metrics,
 * plus operator approval. Automatic promotion is always false.
 */
export function evaluateMarketPromotionGate({
  challenger = null,
  market = null,
  identicalChronologicalWindows = false,
  artifact = correctionsArtifact,
  operatorApproved = false,
  economicClvAvailable = false,
} = {}) {
  const gate = artifact?.marketPromotionGate || {};
  const metrics = gate.metrics || ["marginMae", "totalMae", "winnerAccuracy"];
  const reasons = [];

  if (!identicalChronologicalWindows) {
    reasons.push("identical-chronological-windows-required");
  }
  if (!challenger || !market) {
    reasons.push("challenger-or-market-metrics-missing");
  }

  const comparisons = {};
  let beatsAll = Boolean(challenger && market && identicalChronologicalWindows);
  for (const metric of metrics) {
    const c = finite(challenger?.[metric]);
    const m = finite(market?.[metric]);
    let beats = false;
    if (c == null || m == null) {
      comparisons[metric] = { challenger: c, market: m, beats: false, reason: "missing" };
      beatsAll = false;
      reasons.push(`metric-${metric}-missing`);
      continue;
    }
    // Lower MAE is better; higher winnerAccuracy is better.
    if (metric === "winnerAccuracy") beats = c > m;
    else beats = c < m;
    comparisons[metric] = { challenger: c, market: m, beats };
    if (!beats) {
      beatsAll = false;
      reasons.push(`does-not-beat-closing-on-${metric}`);
    }
  }

  if (gate.requireBeatsClosingOnIdenticalWindows && !beatsAll) {
    // already recorded
  }
  if (gate.operatorApprovalRequired && !operatorApproved) {
    reasons.push("operator-approval-required");
  }
  if (!economicClvAvailable) {
    reasons.push("clv-economics-unavailable");
  }

  const researchGatePassed =
    beatsAll &&
    identicalChronologicalWindows &&
    Boolean(operatorApproved) &&
    Boolean(economicClvAvailable);

  return {
    schema: "nfl-market-promotion-gate-v1",
    requireBeatsClosingOnIdenticalWindows: Boolean(gate.requireBeatsClosingOnIdenticalWindows),
    metrics,
    comparisons,
    beatsClosingOnIdenticalWindows: beatsAll && identicalChronologicalWindows,
    automaticPromotion: false,
    operatorApprovalRequired: gate.operatorApprovalRequired !== false,
    operatorApproved: Boolean(operatorApproved),
    economicClvAvailable: Boolean(economicClvAvailable),
    researchGatePassed,
    canAuthorizeWager: false,
    productionChampionUnchanged: true,
    championModel: NFL_PRODUCTION_CHAMPION.modelId,
    reasons,
    recommendation: researchGatePassed
      ? "Research gate evidence complete — still requires separate operator promotion action; this helper never promotes."
      : "No promotion. Challenger remains research/shadow.",
  };
}

export function isWeakResearchLaneQuarantined(modelVersion, artifact = correctionsArtifact) {
  const list = artifact?.weakResearchQuarantine || [];
  return list.includes(String(modelVersion || ""));
}

export function weakResearchQuarantineList(artifact = correctionsArtifact) {
  return [...(artifact?.weakResearchQuarantine || [])];
}

/** Feature-family auth: trenches/ST stay null unless an authorized source stamped the side features. */
export function featureFamilyAuthorized(sideFeatures = {}, family) {
  const policy = correctionsArtifact?.featureFamilyPolicy || {};
  if (policy.neverImpute === false) return true;
  const auth = sideFeatures?.featureFamilyAuthorization || {};
  if (family === "trenches") {
    return auth.trenches === true || sideFeatures.trenchesAuthorized === true;
  }
  if (family === "specialTeams") {
    return auth.specialTeams === true || sideFeatures.specialTeamsAuthorized === true;
  }
  return false;
}

export function featureFamilyPolicyStamp(artifact = correctionsArtifact) {
  return {
    ...(artifact?.featureFamilyPolicy || {}),
    trenches: artifact?.featureFamilyPolicy?.trenches || "NULL_UNTIL_AUTHORIZED_SOURCE",
    specialTeams: artifact?.featureFamilyPolicy?.specialTeams || "NULL_UNTIL_AUTHORIZED_SOURCE",
    neverImpute: artifact?.featureFamilyPolicy?.neverImpute !== false,
  };
}

/** PIT / publication stamp for research corrections layer. */
export function researchCorrectionsPublicationStamp(projection = {}) {
  const rc = projection?.researchCorrections;
  if (!rc?.applied) {
    return { researchCorrectionsApplied: false };
  }
  return {
    researchCorrectionsApplied: true,
    researchCorrectionsSchema: rc.schema || NFL_RESEARCH_CORRECTIONS_SCHEMA,
    researchCorrectionsLifecycle: rc.lifecycle || NFL_RESEARCH_CORRECTIONS_LIFECYCLE,
    researchCorrectionsFittedAt: rc.fittedAt || null,
    marginResidual: rc.residuals?.marginResidual ?? null,
    totalResidual: rc.residuals?.totalResidual ?? null,
    pHomeWinRaw: projection.pHomeWinRaw ?? null,
    pHomeWinCalibrated: projection.pHomeWinCalibrated ?? projection.pHomeWin ?? null,
    altersChampion: false,
    canAuthorizeWager: false,
  };
}
