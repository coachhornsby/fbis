import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditTicketEv, anomalyRuleDetails } from "../functions/lib/evAudit.js";

describe("ev anomaly reconciliation", () => {
  it("can report multiple findings for one ticket", () => {
    const out = auditTicketEv({
      fair: 1.3,
      pinPrice: 0,
      ev: 1.4,
      result: "OPEN",
      qualifiedAt: null,
    });
    assert.ok(out.reasons.length >= 3);
    assert.ok(out.reasons.includes("probability-out-of-range"));
    assert.ok(out.reasons.includes("invalid-american-odds"));
  });

  it("classifies long-odds warning as non-invalid", () => {
    const info = anomalyRuleDetails("ev-over-100pct");
    assert.equal(info.severity, "WARNING");
    assert.equal(info.canBeLegitimateLongOdds, true);
    assert.equal(info.mustQuarantine, false);
  });
});
