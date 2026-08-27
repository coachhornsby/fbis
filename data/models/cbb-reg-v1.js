/** Compact Worker artifact for CBB-REG-v1. Trained offline; never in a Worker request. */
export default {
  id: "cbb-reg-v1",
  modelId: "CBB-REG-v1",
  trainingCutoff: "2025-04-08",
  trainingHash: "fixture-ridge-v1",
  sourceVersions: { cbbd: "ratings-adjusted", featureSchema: "cbb-features-v1" },
  expectedUnits: {
    home_adj_oe: "points per 100 possessions, opponent-adjusted",
    home_adj_de: "points allowed per 100, opponent-adjusted (higher = worse)",
    possessions: "expected possessions",
    hca: "points, 3.5 true home / 0 neutral",
  },
  requiredFeatures: ["home_adj_oe", "home_adj_de", "away_adj_oe", "away_adj_de", "possessions"],
  featureNames: ["home_adj_oe", "home_adj_de", "away_adj_oe", "away_adj_de", "possessions", "hca"],
  coefficients: {
    home: {
      intercept: 0,
      home_adj_oe: 0.34,
      away_adj_de: 0.34,
      home_adj_de: 0,
      away_adj_oe: 0,
      possessions: 0.01,
      hca: 0.5,
    },
    away: {
      intercept: 0,
      away_adj_oe: 0.34,
      home_adj_de: 0.34,
      home_adj_oe: 0,
      away_adj_de: 0,
      possessions: 0.01,
      hca: -0.5,
    },
  },
  notes: "Regularized toward efficiency×tempo identity. Market lines are not features.",
};
