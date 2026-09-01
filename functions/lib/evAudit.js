import { expectedRoi, validAmericanOdds } from "./pricing.js";

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
