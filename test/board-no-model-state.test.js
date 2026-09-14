import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  boardDecision,
  deriveBoardMispriceState,
  fbisProjection,
  hasPureFbisProjection,
  modelQualityView,
  safeDisplayString,
  teamCardTitle,
  BOARD_MISPRICE_STATE,
} from "../src/lib/boardDecision.js";
import { evaluateMisprice } from "../functions/lib/canonical/mispriceEngine.js";
import { MISPRICE_STATE } from "../functions/lib/canonical/maturityStates.js";

function nflCard(extra = {}) {
  return {
    id: "nfl-1",
    sport: "nfl",
    projectionKind: "PINNACLE_IMPLIED",
    qualified: false,
    authorized: false,
    quality: { score: 64 },
    marketProjAway: 21.5,
    marketProjHome: 24.0,
    odds: { pinPresent: true, pinSpread: -3, pinTotal: 45.5 },
    away: {
      name: "Green Bay Packers",
      fullName: "Green Bay Packers",
      school: "Green Bay",
      nickname: "Packers",
      abbr: "GB",
    },
    home: {
      name: "Minnesota Vikings",
      fullName: "Minnesota Vikings",
      school: "Minnesota",
      nickname: "Vikings",
      abbr: "MIN",
    },
    venue: { name: "Lambeau Field", city: "Green Bay" },
    status: { state: "scheduled", detail: "Pregame" },
    ...extra,
  };
}

describe("board NO_MODEL / PASS contract", () => {
  it("qualified=false alone does not produce PASS when PURE projection is missing", () => {
    const g = nflCard({ qualified: false, rec: null, lean: null });
    const d = boardDecision(g);
    assert.equal(d.tier, "NO_MODEL");
    assert.notEqual(d.tier, "PASS");
    assert.match(d.label, /NO PURE MODEL|NO MODEL/i);
  });

  it("missing PURE projection produces NO_MODEL", () => {
    assert.equal(hasPureFbisProjection(nflCard()), false);
    assert.equal(deriveBoardMispriceState(nflCard()), BOARD_MISPRICE_STATE.NO_MODEL);
    assert.equal(boardDecision(nflCard()).mispriceState, "NO_MODEL");
    assert.equal(fbisProjection(nflCard()).available, false);
  });

  it("PINNACLE_IMPLIED cannot produce PASS", () => {
    const d = boardDecision(nflCard());
    assert.notEqual(d.tier, "PASS");
    assert.equal(d.mispriceState, "NO_MODEL");
  });

  it("PINNACLE_IMPLIED cannot produce CALIBRATED_EDGE", () => {
    const mis = evaluateMisprice({
      projection: 24.5,
      marketLine: 21,
      projectionKind: "PINNACLE_IMPLIED",
      hasPureProjection: false,
      calibrationLocked: true,
      identityResolved: true,
      marketFresh: true,
      modelProbability: 0.58,
    });
    assert.equal(mis.state, MISPRICE_STATE.NO_MODEL);
    assert.notEqual(mis.state, MISPRICE_STATE.CALIBRATED_EDGE);
    assert.notEqual(mis.state, "PASS");
  });

  it("no model quality is shown when no applicable model exists", () => {
    const q = modelQualityView(nflCard());
    assert.equal(q.hasPureModel, false);
    assert.equal(q.modelQuality, null);
    assert.equal(q.score, null);
  });

  it("market quality can still be displayed separately", () => {
    const q = modelQualityView(nflCard());
    assert.equal(q.marketDataQuality, 64);
    assert.equal(q.dataState, "MARKET ONLY");
    assert.equal(q.sportDataState, "READY");
    // Pinnacle-only cards are reference benchmarks, not operational market readiness.
    assert.equal(q.marketDataState, "REFERENCE_ONLY");
    assert.equal(q.modelInputsState, "MISSING");
    assert.equal(q.projectionState, "MISSING");
  });

  it("raw objects cannot render as [object Object]", () => {
    const g = nflCard();
    assert.equal(safeDisplayString(g.venue), "Lambeau Field");
    assert.equal(safeDisplayString(g.status), "scheduled");
    assert.equal(String(safeDisplayString(g.venue)).includes("[object Object]"), false);
    assert.equal(String(safeDisplayString(g.status)).includes("[object Object]"), false);
    assert.equal(teamCardTitle(g.away), "Green Bay Packers");
    assert.equal(teamCardTitle(g.home), "Minnesota Vikings");
    // Single canonical title — not duplicated school+nickname concatenation
    assert.equal(teamCardTitle(g.away).split("Packers").length - 1, 1);
    assert.equal(teamCardTitle(g.home).split("Vikings").length - 1, 1);
  });

  it("eligible model with no edge still may PASS", () => {
    const g = {
      sport: "mlb",
      projectionKind: "FBIS",
      model: { projAway: 4.2, projHome: 3.9 },
      odds: { pinPresent: true, pinSpread: -1.5, pinTotal: 8.5 },
      quality: { score: 80 },
    };
    assert.equal(hasPureFbisProjection(g), true);
    assert.equal(boardDecision(g).tier, "PASS");
    assert.equal(modelQualityView(g).hasPureModel, true);
    assert.equal(modelQualityView(g).modelQuality, 80);
  });
});
