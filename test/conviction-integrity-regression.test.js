import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateConvictionGates } from "../functions/lib/convictionGate.js";
import { expectedRoi } from "../functions/lib/pricing.js";
import { recommendBundle } from "../functions/lib/slateEngine.js";

function baseCandidate(overrides = {}) {
  return {
    qualified: true,
    lean: false,
    modelProbability: 0.61,
    pinPrice: -110,
    benchmarkBook: "Pinnacle",
    benchmarkPrice: -110,
    executionPrice: -110,
    marketComplete: true,
    implied: 0.52,
    market: "ML",
    side: "HOME",
    checkpoint: "MORNING",
    qualifiedAt: "2026-09-03T12:00:00.000Z",
    start: "2026-09-03T23:00:00.000Z",
    modelVersion: "FBIS-v1.4",
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
  it("uses the executable Heritage price when it exists and differs from Pinnacle", () => {
    const candidate = baseCandidate({
      executionPrice: -125,
      ev: expectedRoi(0.61, -110),
    });
    const out = gate(candidate);
    assert.equal(out.ok, false);
    assert.equal(out.reason, "expected-roi-mismatch");
    assert.equal(out.qualificationBook, "Heritage");
    assert.ok(Math.abs(out.expectedRoi - expectedRoi(0.61, -125)) < 1e-12);
  });

  it("allows a Pinnacle-only candidate when Heritage is unpriced", () => {
    const candidate = baseCandidate({ executionPrice: null });
    const out = gate(candidate);
    assert.equal(out.ok, true);
    assert.equal(out.qualificationBook, "Pinnacle");
    assert.equal(out.qualificationPrice, -110);
    assert.ok(Math.abs(out.expectedRoi - expectedRoi(0.61, -110)) < 1e-12);
  });

  it("still rejects incomplete two-way Pinnacle markets", () => {
    const candidate = baseCandidate({ executionPrice: null, marketComplete: false });
    const out = gate(candidate);
    assert.equal(out.ok, false);
    assert.equal(out.reason, "incomplete-two-way-market");
  });

  it("quarantines extreme model/market disagreement instead of calling it edge", () => {
    const candidate = baseCandidate({
      modelProbability: 0.61,
      implied: 0.10,
      ev: expectedRoi(0.61, 900),
      pinPrice: 900,
      benchmarkPrice: 900,
      executionPrice: null,
    });
    const out = gate(candidate);
    assert.equal(out.ok, false);
    assert.equal(out.reason, "extreme-model-market-disagreement");
  });

  it("emits Pinnacle-qualified CONVICTION without fabricating a Heritage fill", () => {
    const game = {
      home: { name: "Home" },
      away: { name: "Away" },
      odds: {
        heritageListed: false,
        pinHomeMl: -110,
        pinAwayMl: -110,
      },
      pin: {
        ml: {
          complete: true,
          noVigA: 0.5,
          noVigB: 0.5,
          priceA: -110,
          priceB: -110,
          vig: 0.048,
        },
      },
    };
    const bundle = recommendBundle("mlb", game, { layers: { score: 0.62 } });
    assert.equal(bundle.qualified?.tag, "CONVICTION");
    assert.equal(bundle.qualified?.qualificationSource, "Pinnacle-qualified");
    assert.equal(bundle.qualified?.qualificationBook, "Pinnacle");
    assert.equal(bundle.qualified?.executionBook, null);
    assert.equal(bundle.qualified?.executionPrice, null);
    assert.equal(bundle.qualified?.benchmarkPrice, -110);
  });

  it("allows internally consistent Heritage pricing inside the disagreement limit", () => {
    const candidate = baseCandidate();
    const out = gate(candidate);
    assert.equal(out.ok, true);
    assert.equal(out.qualificationBook, "Heritage");
    assert.ok(Math.abs(out.expectedRoi - expectedRoi(0.61, -110)) < 1e-12);
  });
});
