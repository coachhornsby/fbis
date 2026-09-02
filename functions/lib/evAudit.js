import { expectedRoi, validAmericanOdds } from "./pricing.js";

export const ANOMALY_RULES = {
  "probability-out-of-range": {
    id: "probability-out-of-range",
    meaning: "Model probability is missing or outside [0,1].",
    severity: "INVALID",
    mathematicallyImpossible: true,
    canBeLegitimateLongOdds: false,
    missingData: false,
    incompleteTwoWayPricing: false,
    probabilityConversionRisk: true,
    staleOrMismatchedMarket: false,
    selectionInversion: false,
    postStartSnapshot: false,
    mustQuarantine: true,
    mayRemainEligibleAfterReview: false,
  },
  "invalid-american-odds": {
    id: "invalid-american-odds",
    meaning: "American odds are missing/invalid (for example 0).",
    severity: "INVALID",
    mathematicallyImpossible: true,
    canBeLegitimateLongOdds: false,
    missingData: true,
    incompleteTwoWayPricing: false,
    probabilityConversionRisk: false,
    staleOrMismatchedMarket: false,
    selectionInversion: false,
    postStartSnapshot: false,
    mustQuarantine: true,
    mayRemainEligibleAfterReview: false,
  },
  "incomplete-two-way-market": {
    id: "incomplete-two-way-market",
    meaning: "Required opposing/no-vig market evidence is incomplete.",
    severity: "QUARANTINED",
    mathematicallyImpossible: false,
    canBeLegitimateLongOdds: false,
    missingData: true,
    incompleteTwoWayPricing: true,
    probabilityConversionRisk: false,
    staleOrMismatchedMarket: true,
    selectionInversion: false,
    postStartSnapshot: false,
    mustQuarantine: true,
    mayRemainEligibleAfterReview: true,
  },
  "ev-over-100pct": {
    id: "ev-over-100pct",
    meaning: "Stored expected ROI exceeds +100%.",
    severity: "WARNING",
    mathematicallyImpossible: false,
    canBeLegitimateLongOdds: true,
    missingData: false,
    incompleteTwoWayPricing: false,
    probabilityConversionRisk: true,
    staleOrMismatchedMarket: true,
    selectionInversion: true,
    postStartSnapshot: false,
    mustQuarantine: false,
    mayRemainEligibleAfterReview: true,
  },
  "ev-below-minus-100pct": {
    id: "ev-below-minus-100pct",
    meaning: "Stored expected ROI is below -100%.",
    severity: "INVALID",
    mathematicallyImpossible: true,
    canBeLegitimateLongOdds: false,
    missingData: false,
    incompleteTwoWayPricing: false,
    probabilityConversionRisk: true,
    staleOrMismatchedMarket: true,
    selectionInversion: true,
    postStartSnapshot: false,
    mustQuarantine: true,
    mayRemainEligibleAfterReview: false,
  },
  "stored-vs-recomputed-mismatch": {
    id: "stored-vs-recomputed-mismatch",
    meaning: "Stored ROI materially differs from frozen-input recomputation.",
    severity: "QUARANTINED",
    mathematicallyImpossible: false,
    canBeLegitimateLongOdds: false,
    missingData: false,
    incompleteTwoWayPricing: false,
    probabilityConversionRisk: true,
    staleOrMismatchedMarket: true,
    selectionInversion: true,
    postStartSnapshot: false,
    mustQuarantine: true,
    mayRemainEligibleAfterReview: true,
  },
  "missing-freeze-timestamp": {
    id: "missing-freeze-timestamp",
    meaning: "Open ticket lacks a pre-execution freeze timestamp.",
    severity: "QUARANTINED",
    mathematicallyImpossible: false,
    canBeLegitimateLongOdds: false,
    missingData: true,
    incompleteTwoWayPricing: false,
    probabilityConversionRisk: false,
    staleOrMismatchedMarket: true,
    selectionInversion: false,
    postStartSnapshot: true,
    mustQuarantine: true,
    mayRemainEligibleAfterReview: true,
  },
};

export function classifyMarketCompleteness(ticket = {}) {
  return validAmericanOdds(ticket.pinPrice) && ticket.entryNoVig != null;
}

export function auditTicketEv(ticket = {}) {
  const p = Number(ticket.fair ?? ticket.traits?.fair ?? ticket.traits?.modelProbability);
  const price = Number(ticket.pinPrice ?? ticket.benchmarkPrice ?? ticket.executionPrice);
  const storedEv = ticket.ev == null ? null : Number(ticket.ev);
  const marketComplete = classifyMarketCompleteness(ticket);
  const recomputedEv = Number.isFinite(p) && validAmericanOdds(price) ? expectedRoi(p, price) : null;
  const reasons = [];
  if (!Number.isFinite(p) || p < 0 || p > 1) reasons.push("probability-out-of-range");
  if (!validAmericanOdds(price)) reasons.push("invalid-american-odds");
  if (!marketComplete) reasons.push("incomplete-two-way-market");
  if (storedEv != null && Number(storedEv) > 1) reasons.push("ev-over-100pct");
  if (storedEv != null && Number(storedEv) < -1) reasons.push("ev-below-minus-100pct");
  if (storedEv != null && recomputedEv != null && Math.abs(storedEv - recomputedEv) > 0.25) reasons.push("stored-vs-recomputed-mismatch");
  if (!ticket.qualifiedAt && String(ticket.result || "").toUpperCase() === "OPEN") reasons.push("missing-freeze-timestamp");
  const anomaly = reasons.length ? reasons[0] : null;
  return {
    anomaly,
    reasons,
    storedEv,
    recomputedEv,
    marketComplete,
    inputs: {
      fair: Number.isFinite(p) ? p : null,
      price: Number.isFinite(price) ? price : null,
      entryNoVig: ticket.entryNoVig ?? null,
      side: ticket.side || null,
      market: ticket.market || null,
    },
  };
}

export function summarizeEvAudits(rows = []) {
  const byReason = {};
  for (const row of rows || []) {
    byReason[row.anomalyReason] = (byReason[row.anomalyReason] || 0) + 1;
  }
  return byReason;
}

export function anomalyRuleDetails(reason) {
  return ANOMALY_RULES[reason] || {
    id: reason || "unknown",
    meaning: "Unclassified anomaly rule.",
    severity: "INFORMATIONAL",
    mathematicallyImpossible: false,
    canBeLegitimateLongOdds: false,
    missingData: false,
    incompleteTwoWayPricing: false,
    probabilityConversionRisk: false,
    staleOrMismatchedMarket: false,
    selectionInversion: false,
    postStartSnapshot: false,
    mustQuarantine: false,
    mayRemainEligibleAfterReview: true,
  };
}
