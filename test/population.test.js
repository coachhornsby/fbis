import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { populationDescriptor, rejectMixedPopulations } from "../functions/lib/populationDescriptor.js";

describe("population descriptor integrity", () => {
  it("creates a normalized descriptor payload", () => {
    const d = populationDescriptor({
      populationType: "strategy_ticket",
      sport: "mlb",
      marketFamily: "total",
      periodFamily: "full-game",
      strategyId: "FBIS-HC-v1",
      strategyVersion: 1,
      modelVersion: "FBIS-v1.3",
      qualificationRuleVersion: "FBIS-HC-v1",
      checkpoint: "LATEST",
      dateRange: { since: "2026-09-01", until: "2026-09-07" },
      settledN: 3,
      openN: 1,
      clvN: 2,
      sourceHealth: "DEGRADED",
    });
    assert.equal(d.sport, "mlb");
    assert.equal(d.marketFamily, "total");
    assert.equal(d.settledN, 3);
  });

  it("rejects mixed sports in one aggregate", () => {
    const out = rejectMixedPopulations(
      [
        { populationDescriptor: populationDescriptor({ populationType: "strategy_ticket", sport: "mlb" }) },
        { populationDescriptor: populationDescriptor({ populationType: "strategy_ticket", sport: "cfb" }) },
      ],
      (r) => r.populationDescriptor
    );
    assert.equal(out.ok, false);
    assert.equal(out.mixed, true);
  });

  it("rejects mixed model versions and checkpoints", () => {
    const out = rejectMixedPopulations(
      [
        { populationDescriptor: populationDescriptor({ populationType: "frozen_projection", sport: "mlb", modelVersion: "A", checkpoint: "LATEST" }) },
        { populationDescriptor: populationDescriptor({ populationType: "frozen_projection", sport: "mlb", modelVersion: "B", checkpoint: "LINEUP_CONFIRMED" }) },
      ],
      (r) => r.populationDescriptor
    );
    assert.equal(out.ok, false);
  });

  it("allows homogeneous descriptors", () => {
    const out = rejectMixedPopulations(
      [
        { populationDescriptor: populationDescriptor({ populationType: "strategy_ticket", sport: "mlb", marketFamily: "moneyline" }) },
        { populationDescriptor: populationDescriptor({ populationType: "strategy_ticket", sport: "mlb", marketFamily: "moneyline" }) },
      ],
      (r) => r.populationDescriptor
    );
    assert.equal(out.ok, true);
  });
});
