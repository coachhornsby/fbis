import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLearningFindings } from "../functions/lib/modelLab.js";

function row(i, {
  model = "M1",
  sport = "cfb",
  marginError = 0,
  totalError = 0,
  p = 0.6,
  actualHomeWin = true,
  projectedMargin = null,
} = {}) {
  const ah = actualHomeWin ? 30 : 20;
  const aa = actualHomeWin ? 20 : 30;
  const actualMargin = ah - aa;
  const actualTotal = ah + aa;
  const projMargin = actualMargin + marginError;
  const projTotal = actualTotal + totalError;
  const ph = (projTotal + projMargin) / 2;
  const pa = (projTotal - projMargin) / 2;
  return {
    sport,
    model_id: model,
    game_id: `g${i}`,
    frozen_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    proj_home: ph,
    proj_away: pa,
    proj_margin: projectedMargin == null ? projMargin : projectedMargin,
    proj_total: projTotal,
    actual_home: ah,
    actual_away: aa,
    p_home_win: p,
  };
}

describe("FBIS model learning findings", () => {
  it("detects recent total-MAE degradation against prior baseline", () => {
    const rows = [];
    for (let i = 0; i < 40; i += 1) rows.push(row(i, { totalError: 1 }));
    for (let i = 40; i < 60; i += 1) rows.push(row(i, { totalError: 4 }));
    const findings = buildLearningFindings(rows, { sport: "cfb", modelId: "M1", recentN: 20 });
    const f = findings.find((x) => x.findingType === "drift" && x.metric === "total.mae");
    assert.ok(f);
    assert.equal(f.baselineN, 40);
    assert.equal(f.recentN, 20);
    assert.ok(f.delta >= 2.5);
    assert.equal(f.status, "OPEN");
  });

  it("does not manufacture drift from a small sample", () => {
    const rows = Array.from({ length: 19 }, (_, i) => row(i, { totalError: 5 }));
    assert.deepEqual(buildLearningFindings(rows, { sport: "cfb", modelId: "M1" }), []);
  });

  it("finds a repeated high-error projected-favorite slice", () => {
    const rows = [];
    for (let i = 0; i < 45; i += 1) rows.push(row(i, { projectedMargin: 8 }));
    for (let i = 45; i < 65; i += 1) rows.push(row(i, { projectedMargin: 15 }));
    const findings = buildLearningFindings(rows, { sport: "cfb", modelId: "M1", recentN: 20 });
    const f = findings.find((x) => x.findingType === "slice" && x.sliceKey === "favorite:large" && x.metric === "margin.mae");
    assert.ok(f);
    assert.ok(f.recentValue > f.baselineValue);
    assert.match(f.hypothesis, /large projected favorites/i);
  });
});
