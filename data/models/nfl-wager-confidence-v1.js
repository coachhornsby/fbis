export const NFL_WAGER_CONFIDENCE_V1 = Object.freeze({
  id: "NFL-CONFIDENCE-v1",
  validated: false,
  trainedThrough: null,
  prospectiveThrough: null,
  minEv: 0.025,
  minProbabilityEdge: 0.02,
  minConfidence: 70,
  bins: [],
  note: "Fail-closed until exact-price, point-in-time decision outcomes demonstrate monotonic confidence and stable positive EV. Do not substitute closing-line buckets or flat -110 assumptions for executable-price calibration.",
});
