import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expectedRoi } from "../functions/lib/pricing.js";
import { evaluateConvictionGates } from "../functions/lib/convictionGate.js";
import { recommendBundle } from "../functions/lib/slateEngine.js";

describe("Pinnacle-qualified CONVICTION", () => {
  it("allows a complete Pinnacle market when Heritage execution price is absent", () => {
    const gate = evaluateConvictionGates({
      candidate: {
        qualified: true,
        lean: false,
        modelProbability: 0.61,
        executionPrice: null,
        benchmarkBook: "Pinnacle",
        benchmarkPrice: -110,
        pinPrice: -110,
        marketComplete: true,
        marketNoVigProbability: 0.5,
        market: "ML",
        side: "HOME",
        checkpoint: "MORNING",
        qualifiedAt: "2026-09-03T14:00:00.000Z",
        start: "2026-09-03T23:00:00.000Z",
        modelVersion: "FBIS-v1.4",
        qualificationRuleVersion: "FBIS-HC-v1",
        ev: expectedRoi(0.61, -110),
      },
      frozen: {
        checkpoint: "MORNING",
        frozenAt: "2026-09-03T14:00:00.000Z",
        start: "2026-09-03T23:00:00.000Z",
        pHomeFinal: 0.61,
      },
      game: { start: "2026-09-03T23:00:00.000Z" },
      paused: false,
      canaryPassed: true,
    });
    assert.equal(gate.ok, true);
    assert.equal(gate.qualificationBook, "Pinnacle");
    assert.equal(gate.qualificationPrice, -110);
  });

  it("still requires a complete two-way Pinnacle market", () => {
    const gate = evaluateConvictionGates({
      candidate: {
        qualified: true,
        lean: false,
        modelProbability: 0.61,
        benchmarkPrice: -110,
        pinPrice: -110,
        marketComplete: false,
        marketNoVigProbability: 0.5,
        market: "ML",
        side: "HOME",
      },
      paused: false,
      canaryPassed: true,
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, "incomplete-two-way-market");
  });

  it("emits a Pinnacle-qualified recommendation without fabricating a Heritage fill", () => {
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
});
