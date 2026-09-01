import test from "node:test";
import assert from "node:assert/strict";
import { walkForwardValidation } from "../functions/lib/walkForward.js";

test("rolling-origin holds out later seasons and reports ablations", () => {
  const rows = [];
  for (const season of [2023, 2024, 2025]) for (let i = 0; i < 210; i++) rows.push({
    season, start: `${season}-09-${String((i % 20) + 1).padStart(2, "0")}T18:00:00Z`,
    featureCutoff: `${season}-09-${String((i % 20) + 1).padStart(2, "0")}T12:00:00Z`,
    actualHome: 28, actualAway: 21,
    models: { champion: { home: 30, away: 20, pHome: .65 }, enriched: { home: 28, away: 21, pHome: .7 }, withoutQb: { home: 29, away: 21 } },
  });
  const report = walkForwardValidation(rows, { ablations: ["withoutQb"] });
  assert.deepEqual(report.folds.map((f) => f.testSeason), [2024, 2025]);
  assert.equal(report.folds[1].trainSeasons.includes(2025), false);
  assert.equal(report.sufficient, true);
  assert.ok(report.maeTotalImprovement > 0);
  assert.equal(report.ablations.withoutQb.n, 420);
});

test("post-kickoff features are rejected as leakage", () => {
  const row = { season: 2025, start: "2025-09-01T18:00:00Z", featureCutoff: "2025-09-01T19:00:00Z", actualHome: 20, actualAway: 10, models: { champion: { home: 20, away: 10 }, enriched: { home: 20, away: 10 } } };
  const report = walkForwardValidation([{ ...row, season: 2024 }, row]);
  assert.equal(report.leakageOk, false);
  assert.equal(report.challenger.n, 0);
});
