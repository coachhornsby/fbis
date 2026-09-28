import test from "node:test";
import assert from "node:assert/strict";
import {
  LEARNING_SPORTS,
  selectCanonicalLearningSnapshots,
  snapshotMarketInformed,
  snapshotModelId,
  toModelLabRow,
  weeklyTrainingArtifact,
} from "../functions/lib/snapshotLearning.js";

test("all six core sports are enrolled in snapshot learning", () => {
  assert.deepEqual([...LEARNING_SPORTS].sort(), ["cbb","cfb","mlb","nba","nfl","nhl"].sort());
});

test("canonical learning snapshot keeps latest graded pregame row and rejects post-start row", () => {
  const base = {
    sport: "nfl",
    gameId: "g1",
    engine: "NFL-FBIS-PURE",
    modelVersion: "research-v0-form",
    start: "2026-09-27T17:00:00Z",
    projHome: 27,
    projAway: 20,
    actualHome: 24,
    actualAway: 21,
  };
  const out = selectCanonicalLearningSnapshots([
    { ...base, frozenAt: "2026-09-27T14:00:00Z", checkpoint: "OPEN" },
    { ...base, frozenAt: "2026-09-27T16:30:00Z", checkpoint: "CLOSE" },
    { ...base, frozenAt: "2026-09-27T17:05:00Z", checkpoint: "LATE" },
  ]);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].checkpoint, "CLOSE");
  assert.equal(out.rejectedPostStart, 1);
});

test("market-implied benchmarks are identified and never confused with independent models", () => {
  assert.equal(snapshotMarketInformed({
    projectionKind: "PINNACLE_IMPLIED",
    engine: "Pinnacle line-implied",
  }), true);
  assert.equal(snapshotMarketInformed({
    projectionKind: "FBIS",
    engine: "NFL-FBIS-PURE",
  }), false);
});

test("snapshot adapter preserves score, result, probability and versioned model identity", () => {
  const row = {
    sport: "mlb",
    gameId: "m1",
    engine: "MLB-RUN-ALLOC-v1",
    modelVersion: "FBIS-v1.4",
    frozenAt: "2026-09-27T12:00:00Z",
    projHome: 4.7,
    projAway: 4.1,
    projMargin: 0.6,
    projTotal: 8.8,
    pHomeFinal: 0.56,
    actualHome: 5,
    actualAway: 3,
  };
  assert.equal(snapshotModelId(row), "MLB-RUN-ALLOC-v1@FBIS-v1.4");
  const adapted = toModelLabRow({ ...row, learningModelId: snapshotModelId(row) });
  assert.equal(adapted.game_id, "m1");
  assert.equal(adapted.proj_home, 4.7);
  assert.equal(adapted.actual_away, 3);
  assert.equal(adapted.p_home_win, 0.56);
});


test("weekly auto-train fits separate margin, total, and probability targets inside one sport/model cohort", () => {
  const rows = Array.from({ length: 40 }, (_, i) => {
    const actualHome = 27 + (i % 3);
    const actualAway = 20 + (i % 2);
    const actualMargin = actualHome - actualAway;
    const actualTotal = actualHome + actualAway;
    return {
      sport: "nfl",
      gameId: `g-${i}`,
      engine: "NFL-FBIS-PURE",
      modelVersion: "research-v0-form",
      frozenAt: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
      start: new Date(Date.UTC(2026, 7, 1 + i, 4)).toISOString(),
      projHome: actualHome + 2,
      projAway: actualAway + 1,
      projMargin: actualMargin + 1,
      projTotal: actualTotal + 3,
      pHomeFinal: 0.7,
      actualHome,
      actualAway,
    };
  });
  const artifact = weeklyTrainingArtifact(rows, {
    sport: "nfl",
    modelId: "NFL-FBIS-PURE@research-v0-form",
  });
  assert.equal(artifact.status, "TRAINED");
  assert.equal(artifact.sport, "nfl");
  assert.ok(artifact.targets.margin);
  assert.ok(artifact.targets.total);
  assert.ok(artifact.targets.homeWinProbability);
  assert.equal(artifact.targets.margin.correction, -1);
  assert.equal(artifact.targets.total.correction, -3);
});
