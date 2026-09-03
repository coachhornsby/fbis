import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateConvictionGates } from "../functions/lib/convictionGate.js";
import { expectedRoi } from "../functions/lib/pricing.js";

function baseCandidate(overrides = {}) {
  return {
    qualified: true,
    lean: false,
    modelProbability: 0.61,
    pinPrice: -110,
    executionPrice: -110,
    marketComplete: true,
    implied: 0.52,
    market: "ML",
    side: "HOME",
    checkpoint: "MORNING",
    qualifiedAt: "2026-09-03T12:00:00.000Z",
    start: "2026-09-03T23:00:00.000Z",
    modelVersion: "FBIS-v1.3",
    qualificationRuleVersion: "FBIS-HC-v1",
    ev: expectedRoi(0.61, -110),
    ...overrides,
  };
}

function gate(candidate) {
  return evaluateConvictionGates({
    candidate,
    frozen: {
      checkpoint: "MORNING",
      frozenAt: "2026-09-03T12:00:00.000Z",
      start: "2026-09-03T23:00:00.000Z",
      pHomeFinal: candidate.modelProbability,
    },
    game: { start: "2026-09-03T23:00:00.000Z" },
    paused: false,
    canaryPassed: true,
  });
}

describe("CONVICTION pricing integrity regressions", () => {
  it("qualifies and computes strategy EV from Pinnacle when Heritage differs", () => {
    const candidate = baseCandidate({
      executionPrice: -125,
      ev: expectedRoi(0.61, -110),
    });
    const out = gate(candidate);
    assert.equal(out.ok, true);
    assert.ok(Math.abs(out.expectedRoi - expectedRoi(0.61, -110)) < 1e-12);
  });

  it("allows a Pinnacle-qualified candidate when Heritage is unpriced", () => {
    const candidate = baseCandidate({ executionPrice: null });
    const out = gate(candidate);
    assert.equal(out.ok, true);
  });

  it("rejects qualification when the Pinnacle price is unavailable", () => {
    const candidate = baseCandidate({ pinPrice: null, benchmarkPrice: null });
    const out = gate(candidate);
    assert.equal(out.ok, false);
    assert.equal(out.reason, "missing-pinnacle-price");
  });

  it("quarantines extreme model/market disagreement instead of calling it edge", () => {
    const candidate = baseCandidate({
      modelProbability: 0.61,
      implied: 0.10,
      ev: expectedRoi(0.61, 900),
      pinPrice: 900,
    });
    const out = gate(candidate);
    assert.equal(out.ok, false);
    assert.equal(out.reason, "extreme-model-market-disagreement");
  });

  it("allows internally consistent executable pricing inside the disagreement limit", () => {
    const candidate = baseCandidate();
    const out = gate(candidate);
    assert.equal(out.ok, true);
    assert.ok(Math.abs(out.expectedRoi - expectedRoi(0.61, -110)) < 1e-12);
  });
});
