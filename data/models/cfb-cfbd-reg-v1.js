/** Compact Worker artifact for CFB-CFBD-REG-v1. Trained offline; never in a Worker request. */
export default {
  id: "cfb-cfbd-reg-v1",
  modelId: "CFB-CFBD-REG-v1",
  trainingCutoff: "2025-12-31",
  trainingHash: "fixture-ridge-v1",
  sourceVersions: { cfbd: "ratings-sp+fpi", featureSchema: "cfb-features-v1" },
  expectedUnits: {
    home_off: "points per game, opponent-adjusted",
    home_def: "points allowed per game, opponent-adjusted",
    hfa: "points, 2.5 true home / 0 neutral",
  },
  requiredFeatures: ["home_off", "home_def", "away_off", "away_def"],
  featureNames: ["home_off", "home_def", "away_off", "away_def", "hfa", "talent_diff", "returning_diff"],
  coefficients: {
    home: {
      intercept: 0.4,
      home_off: 0.48,
      away_def: 0.48,
      home_def: 0,
      away_off: 0,
      hfa: 0.5,
      talent_diff: 0.002,
      returning_diff: 0.01,
    },
    away: {
      intercept: 0.4,
      away_off: 0.48,
      home_def: 0.48,
      home_off: 0,
      away_def: 0,
      hfa: -0.5,
      talent_diff: -0.002,
      returning_diff: -0.01,
    },
  },
  notes: "Ridge toward the ratings identity. Talent/returning are shrunk. Market lines are not features.",
};
