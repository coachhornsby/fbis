import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { confidenceStars, sortByConfidence } from "../src/lib/confidenceStars.js";

function game(id, quality, extra = {}) {
  return {
    id,
    sport: "nfl",
    start: "2026-10-04T17:00:00Z",
    away: { abbr: "AWY", name: "Away" },
    home: { abbr: "HME", name: "Home" },
    model: { projAway: 21, projHome: 27, projTotal: 48, projMargin: 6 },
    projectionKind: "FBIS",
    projectionState: "COMPLETE",
    quality: { score: quality, flags: [] },
    market: {
      marketAvailable: true,
      executionActionable: true,
      execution: { available: true, actionable: true, spread: -3, total: 45 },
    },
    ...extra,
  };
}

describe("board confidence stars", () => {
  it("allows a high-quality qualified game to reach five stars", () => {
    const g = game("five", 94, { rec: { tag: "QUALIFIED", pick: "HME -3", market: "spread", edge: 3 } });
    assert.equal(confidenceStars(g), 5);
  });

  it("does not coerce missing quality to zero and falls back to decision tier", () => {
    const g = game("missing-quality", null, {
      quality: { score: null, flags: [] },
      rec: { tag: "QUALIFIED", pick: "HME -3", market: "spread", edge: 3 },
    });
    assert.equal(confidenceStars(g), 4);
  });

  it("accepts canonical snake_case data_quality when nested quality is absent", () => {
    const g = game("snake-quality", null, {
      quality: undefined,
      data_quality: 84,
      rec: { tag: "QUALIFIED", pick: "HME -3", market: "spread", edge: 3 },
    });
    assert.equal(confidenceStars(g), 4);
  });

  it("accepts sport-specific CFB dataQuality when nested quality is absent", () => {
    const g = game("cfb-quality", null, {
      sport: "cfb",
      quality: undefined,
      cfb: { dataQuality: 88, bettingAllowed: true },
      rec: { tag: "QUALIFIED", pick: "HME -3", market: "spread", edge: 3 },
    });
    assert.equal(confidenceStars(g), 4);
  });

  it("uses the documented quality thresholds exactly", () => {
    const qualified = { rec: { tag: "QUALIFIED", pick: "HME -3", market: "spread", edge: 3 } };
    assert.equal(confidenceStars(game("q90", 90, qualified)), 5);
    assert.equal(confidenceStars(game("q89", 89, qualified)), 4);
    assert.equal(confidenceStars(game("q80", 80, qualified)), 4);
    assert.equal(confidenceStars(game("q79", 79, qualified)), 3);
    assert.equal(confidenceStars(game("q68", 68, qualified)), 3);
    assert.equal(confidenceStars(game("q67", 67, qualified)), 2);
    assert.equal(confidenceStars(game("q55", 55, qualified)), 2);
    assert.equal(confidenceStars(game("q54", 54, qualified)), 1);
  });

  it("keeps explicit data disqualifications at one star regardless of quality", () => {
    const g = game("blocked", 98, { dqState: "DQ" });
    assert.equal(confidenceStars(g), 1);
  });

  it("does not treat a normal quality state as a data disqualification", () => {
    const g = game("ready-state", 84, { quality: { score: 84, state: "READY", flags: [] } });
    assert.equal(confidenceStars(g), 4);
  });

  it("does not collapse wager-blocked CFB projections to one star", () => {
    const g = game("cfb-blocked-complete", 0, {
      sport: "cfb",
      projectionState: "COMPLETE",
      cfb: { projectionState: "COMPLETE", bettingAllowed: false, dataQuality: 0 },
      qualificationBlocked: true,
    });
    assert.equal(confidenceStars(g), 4);
  });

  it("uses CFB projection state as the primary confidence signal", () => {
    const partial = game("cfb-partial", 0, {
      sport: "cfb",
      projectionState: "PARTIAL",
      cfb: { projectionState: "PARTIAL", bettingAllowed: false, dataQuality: 0 },
      qualificationBlocked: true,
    });
    const prior = game("cfb-prior", 0, {
      sport: "cfb",
      projectionState: "PRIOR_ONLY",
      cfb: { projectionState: "PRIOR_ONLY", bettingAllowed: false, dataQuality: 0 },
      qualificationBlocked: true,
    });
    const leagueAvg = game("cfb-league", 0, {
      sport: "cfb",
      projectionState: "LEAGUE_AVERAGE_ONLY",
      cfb: { projectionState: "LEAGUE_AVERAGE_ONLY", bettingAllowed: false, dataQuality: 0 },
      qualificationBlocked: true,
    });
    assert.equal(confidenceStars(partial), 3);
    assert.equal(confidenceStars(prior), 2);
    assert.equal(confidenceStars(leagueAvg), 1);
  });

  it("does not cap research-only projections below their projection confidence", () => {
    const g = game("research", 98, {
      projectionMaturity: "RESEARCH",
      publicationStatus: "RESEARCH_PUBLISHABLE",
      researchProjection: { projAway: 21, projHome: 27 },
    });
    assert.equal(confidenceStars(g), 5);
  });

  it("sorts the board by stars across sports", () => {
    const five = game("five", 94, { sport: "nfl", rec: { tag: "QUALIFIED", pick: "HME -3", market: "spread", edge: 3 } });
    const three = game("three", 74, { sport: "mlb" });
    const four = game("four", 84, { sport: "cfb", rec: { tag: "QUALIFIED", pick: "HME -3", market: "spread", edge: 3 } });
    assert.deepEqual(sortByConfidence([three, five, four]).map((g) => g.id), ["five", "four", "three"]);
  });
});
