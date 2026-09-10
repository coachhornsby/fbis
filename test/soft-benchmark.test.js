import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  benchmarkMarkets,
  pinMarkets,
  softBookLabel,
} from "../functions/lib/pricing.js";
import { recommendBundle } from "../functions/lib/slateEngine.js";
import { DEFAULT_WEIGHTS } from "../functions/lib/weights.js";

function softCfbGame(overrides = {}) {
  return {
    id: "soft-1",
    sport: "cfb",
    start: "2026-09-12T19:00:00.000Z",
    home: { name: "Kansas", school: "Kansas", abbr: "KU" },
    away: { name: "Missouri", school: "Missouri", abbr: "MIZ" },
    marketUnresolved: false,
    odds: {
      spread: 5.5,
      total: 50.5,
      homeMl: 188,
      awayMl: -225,
      pinPresent: false,
      softPresent: true,
      softSource: "sharpapi",
      softSpreadHomePrice: -105,
      softSpreadAwayPrice: -115,
      softOverPrice: -110,
      softUnderPrice: -110,
      spreadPrice: -110,
      totalPrice: -110,
      pinHomeMl: null,
      pinAwayMl: null,
      pinSpreadHomePrice: null,
      pinSpreadAwayPrice: null,
      pinOverPrice: null,
      pinUnderPrice: null,
    },
    cfb: {
      bettingAllowed: true,
      projectionState: "PRIOR_ONLY",
      sigmaMargin: 14,
      sigmaTotal: 12,
      dataQuality: 62,
    },
    model: {
      layers: { market: 0.48, form: 0.52, power: 0.5 },
      projMargin: -4.7,
      projTotal: 50.2,
      projHome: 22.75,
      projAway: 27.45,
    },
    ...overrides,
  };
}

describe("soft-book benchmark (Pin absent)", () => {
  it("labels SharpAPI soft books as DK/FD", () => {
    assert.equal(softBookLabel({ softSource: "sharpapi", softPresent: true }), "DK/FD");
  });

  it("falls back to soft two-ways without writing pin*", () => {
    const game = softCfbGame();
    const pin = pinMarkets(game);
    assert.equal(pin.ml.complete, false);
    assert.equal(pin.spread.complete, false);
    const bench = benchmarkMarkets(game);
    assert.equal(bench.softFallback, true);
    assert.equal(bench.source, "DK/FD");
    assert.equal(bench.ml.complete, true);
    assert.equal(bench.spread.complete, true);
    assert.equal(game.odds.pinPresent, false);
    assert.equal(game.odds.pinHomeMl, null);
    assert.equal(game.odds.pinSpreadHomePrice, null);
  });

  it("prefers complete Pinnacle over soft when Pin is present", () => {
    const game = softCfbGame({
      odds: {
        ...softCfbGame().odds,
        pinPresent: true,
        pinHomeMl: -150,
        pinAwayMl: 130,
        pinSpreadHomePrice: -110,
        pinSpreadAwayPrice: -110,
        pinOverPrice: -110,
        pinUnderPrice: -110,
      },
    });
    const bench = benchmarkMarkets(game);
    assert.equal(bench.softFallback, false);
    assert.equal(bench.source, "Pinnacle");
  });

  it("can emit soft-benchmark LEAN when Pin is absent (PRIOR_ONLY CFB)", () => {
    const game = softCfbGame();
    const bundle = recommendBundle("cfb", game, game.model, DEFAULT_WEIGHTS);
    assert.equal(bundle.qualified, null, "PRIOR_ONLY must not qualify");
    assert.ok(bundle.lean, "soft lines should still surface a lean");
    assert.equal(bundle.lean.softBenchmark, true);
    assert.equal(bundle.lean.book, "DK/FD");
    assert.equal(bundle.lean.benchmarkBook, "DK/FD");
    assert.match(String(bundle.lean.priceSource || ""), /soft-book/i);
    assert.equal(game.odds.pinPresent, false);
    assert.equal(game.odds.pinHomeMl, null);
  });

  it("can qualify on soft DK/FD when CFB projection is betting-allowed and not PRIOR_ONLY", () => {
    const game = softCfbGame({
      cfb: {
        bettingAllowed: true,
        projectionState: "COMPLETE",
        sigmaMargin: 12,
        sigmaTotal: 10,
        dataQuality: 80,
      },
      model: {
        layers: { market: 0.42, form: 0.58, power: 0.45 },
        projMargin: -9.5,
        projTotal: 51,
        projHome: 20.75,
        projAway: 30.25,
      },
      odds: {
        ...softCfbGame().odds,
        spread: 3.5,
        homeMl: 155,
        awayMl: -180,
      },
    });
    const bundle = recommendBundle("cfb", game, game.model, DEFAULT_WEIGHTS);
    const ticket = bundle.qualified || bundle.lean;
    assert.ok(ticket, "soft complete two-ways should price a ticket");
    assert.equal(ticket.softBenchmark, true);
    assert.equal(ticket.book, "DK/FD");
    assert.equal(game.odds.pinPresent, false);
    assert.equal(game.odds.pinSpreadHomePrice, null);
  });
});
