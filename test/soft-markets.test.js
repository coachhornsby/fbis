import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pinMarkets, softBookLabel } from "../functions/lib/pricing.js";
import { recommendBundle } from "../functions/lib/slateEngine.js";
import { DEFAULT_WEIGHTS } from "../functions/lib/weights.js";
import { boardDecision, sortBoardGames } from "../src/lib/boardDecision.js";
import { boardQaFixtureGames, mergeBoardQaFixtures } from "../src/lib/boardFixtures.js";

describe("soft DK/FD pinMarkets fallback", () => {
  it("prefers complete Pinnacle two-ways when present", () => {
    const pin = pinMarkets({
      odds: {
        pinHomeMl: -150,
        pinAwayMl: 130,
        homeMl: -140,
        awayMl: 120,
        pinSpreadHomePrice: -110,
        pinSpreadAwayPrice: -110,
        softSpreadHomePrice: -105,
        softSpreadAwayPrice: -115,
      },
    });
    assert.equal(pin.ml.priceA, -150);
    assert.equal(pin.softOnly, false);
    assert.equal(pin.pinComplete, true);
  });

  it("falls back to soft two-ways when Pin is absent", () => {
    const pin = pinMarkets({
      odds: {
        pinPresent: false,
        softSource: "sharpapi",
        homeMl: -120,
        awayMl: 100,
        softSpreadHomePrice: -110,
        softSpreadAwayPrice: -110,
        softOverPrice: -110,
        softUnderPrice: -110,
      },
    });
    assert.equal(pin.softOnly, true);
    assert.equal(pin.ml.complete, true);
    assert.equal(pin.spread.complete, true);
    assert.equal(pin.total.complete, true);
    assert.equal(softBookLabel({ odds: { softSource: "sharpapi" } }), "DK/FD");
  });
});

describe("soft DK/FD recommendation path", () => {
  it("can mint CONVICTION/STRONG/LEAN tickets from soft books when Pin is exhausted", () => {
    const game = {
      sport: "mlb",
      home: { name: "Detroit Tigers", abbr: "DET" },
      away: { name: "Toronto Blue Jays", abbr: "TOR" },
      odds: {
        pinPresent: false,
        softSource: "sharpapi",
        homeMl: -120,
        awayMl: 100,
        spread: -1.5,
        softSpreadHomePrice: -110,
        softSpreadAwayPrice: -110,
        total: 8.5,
        softOverPrice: -110,
        softUnderPrice: -110,
      },
      model: { layers: { market: 0.62 }, projMargin: 1.8, projTotal: 9.2, pHomeFinal: 0.62 },
      projectionKind: "FBIS",
      quality: { flags: [] },
    };
    const bundle = recommendBundle("mlb", game, game.model, DEFAULT_WEIGHTS);
    assert.ok(bundle.qualified, "expected soft-qualified ticket");
    assert.equal(bundle.qualified.softBenchmark, true);
    assert.equal(bundle.qualified.book, "DK/FD");
    assert.ok(["CONVICTION", "STRONG", "STANDARD", "LEAN"].includes(bundle.qualified.tag));
  });

  it("keeps PRIOR_ONLY CFB soft signals as LEAN only", () => {
    const game = {
      sport: "cfb",
      home: { name: "Kansas State", school: "Kansas State", abbr: "KSU" },
      away: { name: "Washington State", school: "Washington State", abbr: "WSU" },
      odds: {
        pinPresent: false,
        softSource: "sharpapi",
        homeMl: -1200,
        awayMl: 740,
        spread: -17.5,
        softSpreadHomePrice: -110,
        softSpreadAwayPrice: -110,
        total: 48.5,
        softOverPrice: -114,
        softUnderPrice: -106,
        spreadPrice: -110,
      },
      model: { layers: { market: 0.9 }, projMargin: 30, projTotal: 60, pHomeFinal: 0.9 },
      projectionKind: "FBIS",
      cfb: {
        bettingAllowed: true,
        projectionState: "PRIOR_ONLY",
        sigmaMargin: 36.2,
        sigmaTotal: 31.6,
        dataQuality: 55,
      },
      quality: { flags: [] },
    };
    const bundle = recommendBundle("cfb", game, game.model, DEFAULT_WEIGHTS);
    assert.equal(bundle.qualified, null);
    assert.ok(bundle.lean);
    assert.equal(bundle.lean.tag, "LEAN");
    assert.equal(bundle.lean.softBenchmark, true);
    assert.equal(bundle.lean.book, "DK/FD");
  });
});

describe("board QA fixtures", () => {
  it("covers all decision tiers in sort order", () => {
    const sorted = sortBoardGames(boardQaFixtureGames());
    const tiers = sorted.map((g) => boardDecision(g).tier);
    assert.deepEqual(
      [...new Set(tiers)],
      ["CONVICTION", "QUALIFIED", "LEAN", "PASS", "BLOCKED"]
    );
    assert.equal(tiers[0], "CONVICTION");
    assert.equal(tiers.at(-1), "BLOCKED");
  });

  it("only merges fixtures when boardQa=1", () => {
    const live = [{ id: "live-1" }];
    assert.equal(mergeBoardQaFixtures(live, "").length, 1);
    assert.ok(mergeBoardQaFixtures(live, "?boardQa=1").length > 1);
  });
});
