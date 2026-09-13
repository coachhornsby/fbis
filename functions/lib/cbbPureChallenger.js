/**
 * CBB-FBIS-PURE research challenger — possessions × PPP architecture.
 *
 * Does NOT qualify or authorize. Does NOT invent coefficients.
 * Pinnacle-implied scores remain MARKET BENCHMARK only.
 * Baseline status: IMPLEMENTED_RESEARCH_ONLY.
 * Full CBB manual is NOT complete — see cbbProgramAudit.js.
 * Do NOT use OOS_DATA_PENDING for the whole program while KenPom/Torvik/minutes remain pending.
 */

import { MODEL_FAMILY, MODEL_MATURITY } from "./canonical/maturityStates.js";
import { buildProjectionContract, assertPointInTime } from "./canonical/lineageContract.js";
import {
  buildProbabilityProvenance,
  PROBABILITY_SOURCE,
  probabilityAuthority,
} from "./canonical/probabilityAuthority.js";
import {
  expectedPossessions,
  expectedEfficiency,
  CBB_NATIONAL_EFF,
} from "./cbbRatings.js";
import { cbbProgramAudit } from "./cbbProgramAudit.js";

export const CBB_PURE_CHALLENGER_ID = "CBB-FBIS-PURE";
export const CBB_PURE_CHALLENGER_VERSION = "research-v0";

export const CBB_PURE_STATUS = Object.freeze({
  implementation: "IMPLEMENTED_RESEARCH_ONLY",
  maturity: MODEL_MATURITY.RESEARCH,
  canQualify: false,
  canAuthorizeWager: false,
  oosStatus: null,
  programComplete: false,
  note: "Minimal independent possessions×PPP research baseline only — not full CBB manual completion.",
});

/**
 * Research projection from adj OE/DE/tempo — never market-implied.
 * Missing ratings → explicit failure (no silent zero-fill).
 */
export function projectCbbPureChallenger(input = {}) {
  const {
    eventId = null,
    homeAdjOe = null,
    homeAdjDe = null,
    homeTempo = null,
    awayAdjOe = null,
    awayAdjDe = null,
    awayTempo = null,
    hca = 3.5,
    neutral = false,
    informationCutoff = null,
    eventStart = null,
    featureSnapshotId = null,
    generatedAt = new Date().toISOString(),
  } = input;

  if (informationCutoff && eventStart) {
    const pit = assertPointInTime({
      effectiveAt: informationCutoff,
      informationCutoff,
      eventStart,
    });
    if (!pit.ok) {
      return {
        ok: false,
        reason: pit.reason,
        modelId: CBB_PURE_CHALLENGER_ID,
        ...CBB_PURE_STATUS,
      };
    }
  }

  const poss = expectedPossessions(homeTempo, awayTempo, { venueFactor: 1 });
  const homeEff = expectedEfficiency(homeAdjOe, awayAdjDe, CBB_NATIONAL_EFF);
  const awayEff = expectedEfficiency(awayAdjOe, homeAdjDe, CBB_NATIONAL_EFF);
  if (poss == null || homeEff == null || awayEff == null) {
    return {
      ok: false,
      reason: "missing-required-ratings",
      modelId: CBB_PURE_CHALLENGER_ID,
      missingness: {
        homeAdjOe,
        homeAdjDe,
        homeTempo,
        awayAdjOe,
        awayAdjDe,
        awayTempo,
        possessions: poss,
      },
      ...CBB_PURE_STATUS,
    };
  }

  const hcaAdj = neutral ? 0 : Number(hca) || 0;
  const homePts = (homeEff * poss) / 100 + hcaAdj / 2;
  const awayPts = (awayEff * poss) / 100 - hcaAdj / 2;

  const contract = buildProjectionContract({
    eventId,
    sport: "cbb",
    modelId: CBB_PURE_CHALLENGER_ID,
    modelVersion: CBB_PURE_CHALLENGER_VERSION,
    generatedAt,
    informationCutoff,
    featureSnapshotId,
    projectedHome: homePts,
    projectedAway: awayPts,
    projectedMargin: homePts - awayPts,
    projectedTotal: homePts + awayPts,
    family: MODEL_FAMILY.PURE,
    marketInformed: false,
    calibrationLocked: false,
    canQualify: false,
  });

  const provenance = buildProbabilityProvenance({
    probabilitySource: PROBABILITY_SOURCE.HEURISTIC_SIGMA,
    modelFamily: MODEL_FAMILY.PURE,
    modelId: CBB_PURE_CHALLENGER_ID,
    modelVersion: CBB_PURE_CHALLENGER_VERSION,
    validationStatus: MODEL_MATURITY.RESEARCH,
    informationCutoff,
    generatedAt,
  });

  return {
    ok: true,
    modelId: CBB_PURE_CHALLENGER_ID,
    modelVersion: CBB_PURE_CHALLENGER_VERSION,
    projectionKind: "FBIS",
    displayLabel: "RESEARCH · CBB PURE CHALLENGER",
    neverLabelAs: "FBIS PROJECTION (production)",
    marketBenchmarkLabel: "MARKET BENCHMARK",
    contract,
    decomposition: { possessions: poss, homeEff, awayEff, hca: hcaAdj },
    probabilityAuthority: probabilityAuthority(provenance),
    canShowEv: false,
    canQualify: false,
    canAuthorizeWager: false,
    programAudit: cbbProgramAudit(),
    ...CBB_PURE_STATUS,
  };
}
