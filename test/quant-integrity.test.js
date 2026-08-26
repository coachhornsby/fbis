import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  americanToImplied,
  impliedToAmerican,
  twoWayMarket,
  expectedRoi,
  probabilityClv,
  americanProfit,
  brierScore,
  logLoss,
  priceSelection,
} from "../functions/lib/pricing.js";
import { namesMatch, matchEvent, teamsMatch } from "../functions/lib/match.js";
import { pairSpreadSides, pairTotalSides, pickExactRunLinePair, runLine } from "../functions/lib/books.js";
import { isQualifiedTicket, SPORTS, blendWinProb, projectGame } from "../functions/lib/slateEngine.js";
import { freezeFromGame, accuracyOf } from "../functions/lib/projLedger.js";
import { DEFAULT_WEIGHTS } from "../functions/lib/weights.js";

describe("american odds", () => {
  it("converts favorites and dogs", () => {
    assert.equal(americanToImplied(-110).toFixed(4), (110 / 210).toFixed(4));
    assert.equal(americanToImplied(150).toFixed(4), (100 / 250).toFixed(4));
    assert.equal(impliedToAmerican(0.6), -150);
  });
});

describe("two-way no-vig", () => {
  it("removes multiplicative hold", () => {
    const m = twoWayMarket(-110, -110);
    assert.equal(m.complete, true);
    assert.ok(Math.abs(m.noVigA - 0.5) < 1e-9);
    assert.ok(m.vig > 0.04 && m.vig < 0.05);
  });

  it("fails closed when a side is missing", () => {
    const m = twoWayMarket(-110, null);
    assert.equal(m.complete, false);
    assert.equal(m.noVigA, null);
  });
});

describe("EV", () => {
  it("prices a +EV dog correctly", () => {
    const ev = expectedRoi(0.5, 120);
    assert.ok(ev > 0.09 && ev < 0.11);
  });

  it("is null without a price", () => {
    assert.equal(expectedRoi(0.55, null), null);
  });
});

describe("event matching", () => {
  it("does not match shared mascots", () => {
    assert.equal(namesMatch("LSU Tigers", "Auburn Tigers"), false);
    assert.equal(namesMatch("Georgia Bulldogs", "Mississippi State Bulldogs"), false);
  });

  it("matches the same club", () => {
    assert.equal(namesMatch("New York Yankees", "Yankees"), true);
    assert.equal(namesMatch("St. Louis Cardinals", "Saint Louis Cardinals"), true);
  });

  it("requires both teams", () => {
    assert.equal(
      teamsMatch(
        { name: "LSU Tigers", abbr: "LSU" },
        { name: "Auburn Tigers", abbr: "AUB" },
        "LSU Tigers",
        "Alabama Crimson Tide"
      ),
      false
    );
    const hit = matchEvent(
      { home: { name: "LSU Tigers", abbr: "LSU" }, away: { name: "Auburn Tigers", abbr: "AUB" }, start: "2026-09-01T00:00:00Z" },
      [
        { home_team: "LSU Tigers", away_team: "Clemson Tigers", commence_time: "2026-09-01T00:00:00Z" },
        { home_team: "LSU Tigers", away_team: "Auburn Tigers", commence_time: "2026-09-01T00:30:00Z" },
      ]
    );
    assert.equal(hit.away_team, "Auburn Tigers");
  });
});

describe("line pairing", () => {
  it("joins spread sides on the exact opposite point", () => {
    const paired = pairSpreadSides(
      [{ point: -1.5, price: -150 }],
      [{ point: 2.5, price: 130 }, { point: 1.5, price: 130 }]
    );
    assert.equal(paired.point, -1.5);
    assert.equal(paired.away.point, 1.5);
  });

  it("joins totals on the same point", () => {
    const paired = pairTotalSides(
      [{ name: "Over", point: 8.5, price: -110 }, { name: "Over", point: 9, price: -130 }],
      [{ name: "Under", point: 9, price: 110 }, { name: "Under", point: 8.5, price: -110 }]
    );
    assert.equal(paired.point, 8.5);
  });

  it("never rewrites an alternate onto ±1.5", () => {
    assert.equal(runLine("mlb", -2.5), null);
    const paired = pickExactRunLinePair(
      [{ point: -2.5, price: 170 }],
      [{ point: 2.5, price: -200 }],
      "mlb"
    );
    assert.equal(paired, null);
  });
});

describe("qualified +EV gate", () => {
  it("fails when EV is missing", () => {
    assert.equal(isQualifiedTicket(SPORTS.mlb, { marketComplete: true, pinPrice: -110, ev: null, fair: 0.55 }), false);
    assert.equal(isQualifiedTicket(SPORTS.mlb, { marketComplete: false, pinPrice: -110, ev: 0.08, fair: 0.55 }), false);
  });

  it("passes a complete +3% ticket", () => {
    const priced = priceSelection({ pWin: 0.58, twoWay: twoWayMarket(-110, -110), side: "A", pinPrice: -110 });
    assert.equal(isQualifiedTicket(SPORTS.mlb, priced), true);
  });
});

describe("CLV / scores", () => {
  it("measures close minus entry no-vig in percentage points", () => {
    assert.equal(probabilityClv(0.5238, 0.5634).toFixed(2), "3.96");
  });

  it("grades payouts from actual American odds", () => {
    assert.equal(americanProfit(-110).toFixed(4), (100 / 110).toFixed(4));
    assert.equal(americanProfit(-105).toFixed(4), (100 / 105).toFixed(4));
    assert.equal(americanProfit(100), 1);
  });

  it("computes Brier and log loss on the blended probability", () => {
    assert.ok(Math.abs(brierScore(0.7, 1) - 0.09) < 1e-10);
    assert.ok(logLoss(0.7, 1) > 0);
  });
});

describe("score layer freeze", () => {
  it("blends the score layer into the final home probability", () => {
    const p = blendWinProb({ market: 0.5, espn: 0.5, score: 0.7, form: 0.5 }, DEFAULT_WEIGHTS);
    assert.ok(p > 0.55);
  });

  it("freezes pHomeFinal not form", () => {
    const game = {
      id: "1",
      sport: "mlb",
      home: { name: "Yankees", abbr: "NYY" },
      away: { name: "Red Sox", abbr: "BOS" },
      model: {
        projHome: 4.6,
        projAway: 3.9,
        impliedHome: 0.52,
        pHomeFinal: 0.61,
        layers: { market: 0.52, score: 0.64, form: 0.48 },
        recipe: { engine: "Savant", steps: [] },
      },
      pin: { ml: { vig: 0.04, noVigA: 0.52 } },
      odds: { pinHomeMl: -120, pinAwayMl: 110 },
      quality: { score: 88, flags: [] },
      modelVersion: "FBIS-v1.1",
    };
    const frozen = freezeFromGame("2026-08-26", game);
    assert.equal(frozen.pHomeFinal, 0.61);
    assert.equal(frozen.pForm, 0.48);
    assert.equal(frozen.pScore, 0.64);
    const again = freezeFromGame("2026-08-26", { ...game, model: { ...game.model, pHomeFinal: 0.99, layers: { form: 0.1 } } });
    assert.equal(again.pHomeFinal, 0.99);
    const acc = accuracyOf([
      { ...frozen, actualHome: 5, actualAway: 3, actualTotal: 8 },
    ]);
    assert.equal(acc.n, 1);
    assert.ok(acc.brierModel != null);
  });

  it("uses projected margin as the MLB score layer", () => {
    const model = projectGame("mlb", {
      home: { name: "Yankees", record: "50-50" },
      away: { name: "Red Sox", record: "50-50" },
      odds: { spread: -1.5, homeMl: -130, awayMl: 110 },
      projHomeScore: 5.2,
      projAwayScore: 3.8,
      fairHomeMl: -130,
      fairAwayMl: 110,
      modelHint: { formHome: 0.51 },
    });
    assert.ok(model.layers.score > 0.55);
    assert.ok(model.pHomeFinal > 0.5);
  });
});
