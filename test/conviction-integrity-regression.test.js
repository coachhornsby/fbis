import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateConvictionGates } from "../functions/lib/convictionGate.js";
import { expectedRoi } from "../functions/lib/pricing.js";

function baseCandidate(overrides = {}) {
  return {
    qualified: true,
    lean: false,
    sport: "mlb",
    modelId: "MLB-SAVANT-RPG-SP",
    modelProbability: 0.61,
    pinPrice: -110,
    executionPrice: -110,
    marketComplete: true,
    implied: 0.52,
    market: "ML",
    side: "HOME",
    checkpoint: "MORNING",
    qualifiedAt: "2026-09-03T12:00:00.000Z",
    marketObservedAt: "2026-09-03T11:59:00.000Z",
    gameId: "g-mlb",
    sourceProjectionId: "g-mlb",
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
      id: "g-mlb",
      start: "2026-09-03T23:00:00.000Z",
      marketAt: "2026-09-03T11:59:00.000Z",
      pHomeFinal: candidate.modelProbability,
    },
    game: { id: "g-mlb", start: "2026-09-03T23:00:00.000Z" },
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


  it("fails closed when registry canQualify is false", () => {
    const out = gate(baseCandidate({ sport: "cfb", modelId: "CFB-FBIS-v2", modelVersion: "CFB-FBIS-v2" }));
    assert.equal(out.ok, false);
    assert.equal(out.reason, "model-not-qualification-authorized");
  });

  it("fails closed for unknown and wrong-sport model authority", () => {
    const unknown = gate(baseCandidate({ modelId: "UNKNOWN-MODEL" }));
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, "unknown-model-authority");
    const wrongSport = gate(baseCandidate({ sport: "cfb", modelId: "MLB-SAVANT-RPG-SP" }));
    assert.equal(wrongSport.ok, false);
    assert.equal(wrongSport.reason, "model-sport-authority-mismatch");
  });


describe("CONVICTION temporal and identity integrity", () => {
  it("fails closed when canonical event identity mismatches", () => {
    const out = gate(baseCandidate({ gameId: "other-game" }));
    assert.equal(out.ok, false);
    assert.equal(out.reason, "event-identity-mismatch");
  });

  it("fails closed when market observation is after projection freeze", () => {
    const out = gate(baseCandidate({ marketObservedAt: "2026-09-03T12:00:01.000Z" }));
    assert.equal(out.ok, false);
    assert.equal(out.reason, "market-after-projection-freeze");
  });

  it("fails closed without immutable source projection identity", () => {
    const out = gate(baseCandidate({ sourceProjectionId: null }));
    assert.equal(out.ok, false);
    assert.equal(out.reason, "missing-projection-identity");
  });
});
