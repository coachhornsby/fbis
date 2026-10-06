export const NHL_GOALIE_PROB_SHADOW_CONFIG = Object.freeze({
  modelId: "NHL-GOALIE-PROB-SHADOW-v1",
  version: "shadow-v1.0-goalie-probability-shrink-25",
  incumbentModelId: "NHL-PRO-v2",
  goalieProbabilityScale: 0.25,
  historicalSource: "NHL-PERSISTENT-STATE-CHALLENGER-v1",
  historicalGeneratedAt: "2026-10-06T03:33:58.511Z",
  historicalSampleGames: 2624,
  historicalGateValidated: true,
  historicalMetrics: Object.freeze({
    incumbent: Object.freeze({winnerAccuracy:0.56174,brier:0.24117,logLoss:0.675,ece:0.03429}),
    challenger: Object.freeze({winnerAccuracy:0.56364,brier:0.24101,logLoss:0.67468,ece:0.03106}),
  }),
  gateId: "NHL_GOALIE_PROBABILITY_RECAL_V1",
  mode: "SHADOW",
  canQualify: false,
  canAuthorizeWager: false,
  stakingAuthorized: false,
});
