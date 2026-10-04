export const NHL_WAGER_CONFIDENCE_V1 = Object.freeze({
  id: "NHL-CONFIDENCE-v1",
  game: Object.freeze({
    validated: false,
    trainedThrough: null,
    prospectiveThrough: null,
    minEv: 0.03,
    minProbabilityEdge: 0.02,
    minConfidence: 70,
    bins: Object.freeze([]),
    note: "Fail-closed until exact-price point-in-time NHL game decisions demonstrate stable positive ROI, calibration, CLV, drawdown control, and monotonic confidence."
  }),
  prop: Object.freeze({
    validated: false,
    trainedThrough: null,
    prospectiveThrough: null,
    minEv: 0.035,
    minProbabilityEdge: 0.025,
    minConfidence: 70,
    bins: Object.freeze([]),
    note: "Fail-closed until exact-price point-in-time NHL prop decisions demonstrate stable positive ROI, calibration, CLV where available, drawdown control, and monotonic confidence."
  })
});
