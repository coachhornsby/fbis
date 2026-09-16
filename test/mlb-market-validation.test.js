import test from "node:test";
import assert from "node:assert/strict";
import { buildMlbMarketValidation } from "../functions/lib/mlbMarketValidation.js";

function row(overrides = {}) {
  return {
    sport: "mlb",
    date: "2026-09-15",
    gameId: "g1",
    matchup: "CHW @ CLE",
    checkpoint: "PREGAME",
    frozenAt: "2026-09-15T20:45:00.000Z",
    start: "2026-09-15T22:40:00.000Z",
    projAway: 4.9,
    projHome: 3.8,
    actualAway: 6,
    actualHome: 7,
    pinSpread: -1.5,
    pinTotal: 9,
    ...overrides,
  };
}

test("grades a large opposite-side MLB disagreement as the selected ATS side", () => {
  const report = buildMlbMarketValidation([row()]);
  assert.equal(report.side.n, 1);
  assert.equal(report.side.wins, 1);
  assert.equal(report.side.losses, 0);
  assert.equal(report.side.atLeast10.record, "1-0");
  assert.equal(report.games[0].side.selection, "CHW");
  assert.equal(report.games[0].side.line, 1.5);
  assert.equal(report.games[0].side.edge, -2.6);
  assert.equal(report.games[0].side.result, "W");
});

test("grades model-favorite run-line and total directions independently", () => {
  const report = buildMlbMarketValidation([
    row({
      gameId: "lad-cin",
      matchup: "LAD @ CIN",
      projAway: 6.4,
      projHome: 3.0,
      actualAway: 4,
      actualHome: 0,
      pinSpread: 1.5,
      pinTotal: 8.5,
    }),
  ]);
  assert.equal(report.games[0].side.selection, "LAD");
  assert.equal(report.games[0].side.line, -1.5);
  assert.equal(report.games[0].side.result, "W");
  assert.equal(report.games[0].total.selection, "OVER");
  assert.equal(report.games[0].total.result, "L");
  assert.equal(report.total.losses, 1);
});

test("keeps pushes out of hit-rate denominator", () => {
  const report = buildMlbMarketValidation([
    row({
      gameId: "push",
      projAway: 5.5,
      projHome: 4,
      actualAway: 5,
      actualHome: 4,
      pinSpread: 1,
      pinTotal: 9.5,
    }),
  ]);
  assert.equal(report.side.pushes, 1);
  assert.equal(report.side.hitRate, null);
  assert.equal(report.total.n, 0);
});

test("uses only the latest pregame frozen snapshot per game", () => {
  const early = row({
    gameId: "same",
    frozenAt: "2026-09-15T18:00:00.000Z",
    projAway: 4,
    projHome: 5,
  });
  const late = row({
    gameId: "same",
    frozenAt: "2026-09-15T21:00:00.000Z",
    projAway: 5,
    projHome: 4,
  });
  const postStart = row({
    gameId: "same",
    frozenAt: "2026-09-15T23:00:00.000Z",
    projAway: 9,
    projHome: 1,
  });
  const report = buildMlbMarketValidation([early, late, postStart]);
  assert.equal(report.population.games, 1);
  assert.equal(report.games[0].projected.away, 5);
  assert.equal(report.games[0].projected.home, 4);
});

test("tracks the requested edge buckets and >=1.0 cohort", () => {
  const rows = [
    row({ gameId: "b1", projAway: 4.6, projHome: 4.7, actualAway: 1, actualHome: 2, pinSpread: -1.5 }),
    row({ gameId: "b2", matchup: "DET @ TOR", projAway: 4.4, projHome: 3.8, actualAway: 10, actualHome: 1, pinSpread: -1.5 }),
    row({ gameId: "b3", matchup: "ATL @ CHC", projAway: 4.4, projHome: 6.1, actualAway: 6, actualHome: 3, pinSpread: -1.5 }),
  ];
  const report = buildMlbMarketValidation(rows);
  assert.equal(report.side.n, 3);
  assert.equal(report.side.wins, 2);
  assert.equal(report.side.losses, 1);
  assert.equal(report.side.atLeast10.n, 2);
  assert.equal(report.side.atLeast10.record, "2-0");
  assert.equal(report.side.buckets.find((b) => b.key === "0.00-0.49").record, "0-1");
  assert.equal(report.side.buckets.find((b) => b.key === "1.00-1.49").record, "1-0");
  assert.equal(report.side.buckets.find((b) => b.key === "2.00+").record, "1-0");
});
