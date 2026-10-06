import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { confidenceStars, sortByConfidence } from "../src/lib/confidenceStars.js";
import {
  canonicalConfidenceStars,
  canonicalProjectionConfidence,
  CONFIDENCE_VERSION,
} from "../functions/lib/projectionConfidence.js";

function baseGame(id, quality, extra = {}) {
  return {
    id,
    sport: "mlb",
    start: "2026-10-04T17:00:00Z",
    away: { abbr: "AWY", name: "Away" },
    home: { abbr: "HME", name: "Home" },
    model: { projAway: 3.8, projHome: 4.6, projTotal: 8.4, projMargin: 0.8 },
    projectionKind: "FBIS",
    quality: { score: quality, flags: [] },
    ...extra,
  };
}

describe("FBIS-CONFIDENCE-v2", () => {
  it("uses attainable shared confidence bands", () => {
    assert.equal(canonicalConfidenceStars(baseGame("five", 86)), 5);
    assert.equal(canonicalConfidenceStars(baseGame("four", 74)), 4);
    assert.equal(canonicalConfidenceStars(baseGame("three", 60)), 3);
    assert.equal(canonicalConfidenceStars(baseGame("two", 46)), 2);
    assert.equal(canonicalConfidenceStars(baseGame("one", 35)), 1);
  });

  it("returns a versioned canonical score and stars", () => {
    const result = canonicalProjectionConfidence(baseGame("versioned", 74));
    assert.equal(result.version, CONFIDENCE_VERSION);
    assert.equal(result.score, 74);
    assert.equal(result.stars, 4);
    assert.equal(result.source, "QUALITY_SCORE");
  });

  it("keeps hard data disqualifications at one star", () => {
    const result = canonicalProjectionConfidence(baseGame("dq", 99, { dqState: "DQ" }));
    assert.equal(result.stars, 1);
    assert.equal(result.source, "HARD_DQ");
  });

  it("does not reuse legacy soccer star fields", () => {
    const result = canonicalProjectionConfidence(baseGame("soccer", 10, {
      sport: "soccer",
      soccerConfidence: { score: 74, stars: 1, pick: "Home FC" },
    }));
    assert.equal(result.stars, 4);
    assert.equal(result.source, "SOCCER_CONFIDENCE_SCORE");
  });

  it("allows a strong NFL-PRO projection to occupy the five-star band", () => {
    const result = canonicalProjectionConfidence(baseGame("nfl-elite", 90, {
      sport: "nfl",
      model: { projAway: 20, projHome: 31 },
      nflProShadow: {
        ok: true,
        coverage: { share: 0.92 },
        sigmaMargin: 12.8,
        sigmaTotal: 12.0,
        home: 31,
        away: 20,
      },
      market: {
        execution: { spread: -3, total: 44 },
      },
    }));
    assert.equal(result.stars, 5);
    assert.equal(result.source, "NFL_PRO_COMPOSITE");
  });

  it("client display is canonical-only and never recomputes a rating", () => {
    const raw = baseGame("same-game", 99);
    assert.equal(confidenceStars(raw), 1);

    const canonical = canonicalProjectionConfidence(raw);
    const boardShape = { ...raw, confidenceStars: canonical.stars, confidenceScore: canonical.score };
    const marketShape = {
      id: raw.id,
      sport: raw.sport,
      confidenceStars: canonical.stars,
      confidenceScore: canonical.score,
      model: raw.model,
    };

    assert.equal(confidenceStars(boardShape), canonical.stars);
    assert.equal(confidenceStars(marketShape), canonical.stars);
    assert.equal(confidenceStars(boardShape), confidenceStars(marketShape));
  });

  it("sorts by canonical stars then canonical score", () => {
    const rows = [
      { id: "a", sport: "mlb", start: "2026-10-04T17:00:00Z", model: { projAway: 3, projHome: 4 }, confidenceStars: 4, confidenceScore: 72 },
      { id: "b", sport: "mlb", start: "2026-10-04T17:00:00Z", model: { projAway: 3, projHome: 4 }, confidenceStars: 5, confidenceScore: 85 },
      { id: "c", sport: "mlb", start: "2026-10-04T17:00:00Z", model: { projAway: 3, projHome: 4 }, confidenceStars: 4, confidenceScore: 79 },
    ];
    assert.deepEqual(sortByConfidence(rows).map((g) => g.id), ["b", "c", "a"]);
  });
});
