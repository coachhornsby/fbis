import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAdvancedGameViewModel } from "../src/lib/advancedGameViewModel.js";

function fixture(overrides = {}) {
  return {
    id: "mlb-adv-1",
    sport: "mlb",
    start: "2026-09-14T22:40:00Z",
    venue: "Rate Field, Chicago, IL",
    away: {
      abbr: "CHW",
      name: "White Sox",
      fullName: "Chicago White Sox",
      record: "58-84",
      logo: "https://a.espncdn.com/i/teamlogos/mlb/500/chw.png",
    },
    home: {
      abbr: "CLE",
      name: "Guardians",
      fullName: "Cleveland Guardians",
      record: "78-63",
      logo: "https://a.espncdn.com/i/teamlogos/mlb/500/cle.png",
    },
    model: { projAway: 4.3, projHome: 4.0, projTotal: 8.3, projMargin: -0.3 },
    projectionKind: "FBIS",
    projectionState: "COMPLETE",
    rec: { tag: "QUALIFIED", pick: "CLE -1.5", market: "spread" },
    market: {
      marketAvailable: true,
      execution: { available: true, book: "FanDuel", spread: -1.5, total: 6.5 },
    },
    actionIntel: {
      publicSplits: { ticketPct: 34, moneyPct: 78, moneyTicketGap: 44, sharpLabel: null },
      movement: { openingLine: -1, currentLine: -1.5, movementMagnitude: -0.5 },
      booksCount: 4,
      sampleSize: 12600,
      lineRange: { low: -1.5, high: -2.0 },
      collectedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    },
    publicSplits: { ticketPct: 34, moneyPct: 78, moneyTicketGap: 44 },
    weather: { temperature: 78, windSpeed: 8, windDirection: "L->R", description: "Partly Cloudy" },
    ...overrides,
  };
}

describe("buildAdvancedGameViewModel", () => {
  it("builds overview takeaways from real ACTION + model diffs", () => {
    const vm = buildAdvancedGameViewModel(fixture());
    assert.equal(vm.matchupLabel, "CHW @ CLE");
    assert.equal(vm.status.key, "QUALIFIED");
    assert.ok(vm.takeaways.length >= 3);
    assert.equal(vm.projectedScores.total, 8.3);
    assert.equal(vm.bettingSplits.available, true);
    assert.equal(vm.lineHistory.available, true);
    assert.equal(vm.probabilities.win.available, false);
    assert.equal(vm.probabilities.ev.available, false);
  });

  it("never invents provider sharp without sharpLabel", () => {
    const vm = buildAdvancedGameViewModel(fixture());
    assert.ok(!vm.takeaways.some((t) => /ACTION sharp money detected/i.test(t.text)));
  });
});
