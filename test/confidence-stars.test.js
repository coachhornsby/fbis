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

  it("caps research projections at three stars", () => {
    const g = game("research", 98, {
      projectionMaturity: "RESEARCH",
      publicationStatus: "RESEARCH_PUBLISHABLE",
      researchProjection: { projAway: 21, projHome: 27 },
    });
    assert.equal(confidenceStars(g), 3);
  });

  it("sorts the board by stars across sports", () => {
    const five = game("five", 94, { sport: "nfl", rec: { tag: "QUALIFIED", pick: "HME -3", market: "spread", edge: 3 } });
    const three = game("three", 74, { sport: "mlb" });
    const four = game("four", 84, { sport: "cfb", rec: { tag: "QUALIFIED", pick: "HME -3", market: "spread", edge: 3 } });
    assert.deepEqual(sortByConfidence([three, five, four]).map((g) => g.id), ["five", "four", "three"]);
  });
});
