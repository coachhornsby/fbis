import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildBoardGameViewModel,
  buildDecisionPresentation,
} from "../src/lib/boardViewModel.js";

function researchNflGame(overrides = {}) {
  return {
    id: "nfl-1",
    sport: "nfl",
    start: "2026-09-14T00:20:00Z",
    away: { abbr: "DAL", name: "Cowboys" },
    home: { abbr: "NYG", name: "Giants" },
    model: {
      projAway: 30.3,
      projHome: 30.7,
      projTotal: 61,
      projMargin: 0.4,
    },
    projectionMaturity: "RESEARCH",
    researchProjection: true,
    publicationStatus: "RESEARCH_PUBLISHABLE",
    pureProjectionAvailable: true,
    projectionKind: "FBIS",
    market: {
      marketAvailable: true,
      execution: {
        available: true,
        book: "FanDuel",
        spread: 3,
        total: 47.5,
        moneyline: { home: -110, away: -110 },
      },
      consensus: { available: false },
      reference: { available: false },
    },
    ...overrides,
  };
}

describe("Board game view-model", () => {
  it("surfaces FBIS projection prominently for research models", () => {
    const vm = buildBoardGameViewModel(researchNflGame());
    assert.equal(vm.projection.available, true);
    assert.equal(vm.projection.research, true);
    assert.match(String(vm.projection.headlineLabel), /FBIS/);
    assert.equal(vm.projection.away, 30.3);
    assert.equal(vm.projection.home, 30.7);
  });

  it("prefers execution market and never requires Pinnacle", () => {
    const vm = buildBoardGameViewModel(researchNflGame());
    assert.equal(vm.market.available, true);
    assert.equal(vm.market.referenceOnly, false);
    assert.equal(vm.market.book, "FanDuel");
    assert.match(String(vm.market.label), /BEST|AVAILABLE|EXECUTION|OBSERVED/i);
  });

  it("labels disagreement as model difference — not EV — for research", () => {
    const vm = buildBoardGameViewModel(researchNflGame());
    assert.equal(vm.authority.research, true);
    assert.equal(vm.authority.evAvailable, false);
    assert.equal(vm.decision.ev, null);
    assert.equal(vm.decision.qualification, "RESEARCH_ONLY");
    assert.match(String(vm.comparison.label), /DIFFERENCE|MODEL/i);
    assert.equal(vm.comparison.hasDiff, true);
  });

  it("does not invent qualification or authorization for research", () => {
    const d = buildDecisionPresentation(researchNflGame());
    assert.equal(d.qualification, "RESEARCH_ONLY");
    assert.notEqual(d.qualification, "QUALIFIED");
    assert.equal(d.evAvailable, false);
    assert.equal(d.humanConfirmationRequired, true);
    assert.ok(d.authorization === "NONE" || d.authorization === "AWAITING_REVIEW");
  });

  it("stays usable when only reference market exists", () => {
    const vm = buildBoardGameViewModel(
      researchNflGame({
        market: {
          marketAvailable: false,
          execution: { available: false },
          consensus: { available: false },
          reference: {
            available: true,
            provider: "Pinnacle",
            spread: 2.5,
            total: 47,
            moneyline: { home: -105, away: -115 },
          },
        },
      })
    );
    assert.equal(vm.projection.available, true);
    assert.equal(vm.market.available, false);
    assert.equal(vm.market.referenceOnly, true);
    assert.match(String(vm.market.label), /REFERENCE/i);
    assert.ok(vm.market.emptyReason);
  });

  it("does not crash on missing team identity", () => {
    const vm = buildBoardGameViewModel(
      researchNflGame({
        away: { abbr: "SEA" },
        home: null,
      })
    );
    assert.equal(vm.teams.identityOk, false);
    assert.equal(vm.projection.available, true);
  });
});
