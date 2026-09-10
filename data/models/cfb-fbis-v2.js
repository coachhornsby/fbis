/**
 * Provisional CFB-FBIS-v2 artifact.
 * Coefficients are starting points for shadow / ablation — not promoted.
 * Temporal OOS fitting must replace these before any promotion recommendation.
 */

export default {
  id: "cfb-fbis-v2-artifact-provisional",
  modelId: "CFB-FBIS-v2",
  version: "v2-provisional",
  role: "shadow",
  canQualify: false,
  trainingCutoff: null,
  trainingHash: "provisional-unfitted",
  sourceVersion: "cfbd-feature-pipeline-v2",
  sourceVersions: {
    catalog: "cfb-feature-catalog-v2",
    pipeline: "cfb-feature-pipeline-v2",
    canonical: "cfbd-canonical-v1",
  },
  expectedUnits: {
    margin: "points (home - away)",
    total: "points",
    ppa: "predicted points added per play",
  },
  notes:
    "Provisional coefficients for architecture + temporal integrity tests. Do not promote. Fit via rolling-origin folds on frozen pregame features only.",
  coefficients: {
    hfa: 2.5,
    nationalPpg: 26.5,
    expectedPossessions: 12.2,
    possessionPaceScale: 0.35,
    marginSigma: 16.5,
    totalSigma: 14.5,
    reliabilityShrink: 0.25,
    scales: {
      pass: 8,
      rush: 6,
      success: 12,
      explosiveness: 10,
      havoc: 8,
      trenches: 1.2,
      finishing: 1.1,
      pace: 1.5,
    },
    qb: {
      residualScale: 6,
      rawScale: 4,
      maxAbs: 3.5,
      unknownMult: 1.2,
      limitedSampleMult: 1.12,
      transferMult: 1.18,
    },
    fcs: {
      scale: 0.35,
      maxAbs: 14,
      missingUncertaintyMult: 1.25,
      baseUncertaintyBump: 0.08,
    },
    context: {
      windThreshold: 15,
      windPenalty: -0.4,
      coldThreshold: 35,
      coldPenalty: -0.3,
    },
  },
};
