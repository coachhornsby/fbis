import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildAccuracyDailySummaries, rollupAccuracySummaries } from "../functions/lib/accuracySummary.js";

test("daily aggregates retain sufficient statistics without game rows", () => {
  const rows = [
    { sport: "cfb", date: "2026-08-29", checkpoint: "CLOSE", modelVersion: "v1", projHome: 30, projAway: 20, actualHome: 28, actualAway: 21, pHomeFinal: 0.7 },
    { sport: "cfb", date: "2026-08-29", checkpoint: "CLOSE", modelVersion: "v1", projHome: 17, projAway: 24, actualHome: 20, actualAway: 23, pHomeFinal: 0.4 },
  ];
  const daily = buildAccuracyDailySummaries(rows, "2026-08-30T00:00:00.000Z");
  assert.equal(daily.length, 1);
  assert.equal(daily[0].projectedN, 2);
  assert.equal(daily[0].gradedN, 2);
  const rolled = rollupAccuracySummaries(daily.map((r) => ({
    projected_n: r.projectedN, graded_n: r.gradedN, abs_total_error_sum: r.absTotalErrorSum,
    total_bias_sum: r.totalBiasSum, winner_correct_n: r.winnerCorrectN,
    winner_graded_n: r.winnerGradedN, brier_sum: r.brierSum, brier_n: r.brierN,
  })));
  assert.equal(rolled.projected, 2);
  assert.equal(rolled.graded, 2);
  assert.equal(rolled.winnerHit, 1);
  assert.ok(Number.isFinite(rolled.maeTotal));
});

test("observability migration creates stage and accuracy summary stores", () => {
  const sql = fs.readFileSync(new URL("../migrations/0011_observability_summaries.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pipeline_stage_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS accuracy_daily_summary/);
  assert.match(sql, /schema_migrations/);
});
