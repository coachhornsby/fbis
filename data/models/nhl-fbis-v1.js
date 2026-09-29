/**
 * NHL-FBIS-v1 historical artifact.
 *
 * This seed is intentionally conservative and is replaced by
 * scripts/nhl-historical-fit.mjs after the controlled historical fit.
 * It contains no market-derived inputs.
 */
export const NHL_FBIS_V1_ARTIFACT = Object.freeze({
  artifactVersion: "research-v1-bootstrap-seed",
  generatedAt: null,
  trained: false,
  marketInformed: false,
  seasons: [],
  xg: {
    featureOrder: [
      "intercept",
      "distance50",
      "angle90",
      "distanceSq2500",
      "angleSq8100",
      "rebound",
      "reboundDistance50",
      "wrist",
      "snap",
      "slap",
      "backhand",
      "tip",
      "deflected",
      "wrap",
      "poke"
    ],
    coefficients: [
      -2.20,
      -1.20,
      -0.50,
      -0.40,
      -0.20,
      0.50,
      -0.20,
      0.10,
      0.18,
      -0.10,
      -0.05,
      0.50,
      0.45,
      -0.30,
      -0.10
    ],
    trainShots: 0,
    trainGoals: 0,
    validationShots: 0,
    validationGoals: 0,
    validationBrier: null,
    validationLogLoss: null
  },
  league: {
    fiveVFiveXgPerTeamGame: 2.35,
    goalsPerTeamGame: 3.05,
    ppOpportunitiesPerTeamGame: 3.0,
    ppPct: 0.21
  },
  teams: {},
  goalies: {},
  expectedGoalieByTeam: {}
});
