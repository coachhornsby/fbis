import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mean,
  variance,
  mae,
  fitRidge,
  predictRidge,
  tuneRidgeLambda,
  pairedBlockBootstrap,
  ABLATION_FEATURE_SETS,
  TOTAL_FEATURE_SETS,
  rowToMarginX,
  rowToTotalX,
  scoreMetrics,
  pHomeWinFromMargin,
} from "../functions/lib/cfbFbisV2Fit.js";
import { ABLATION_MASKS, CFB_FBIS_V2_ID } from "../functions/lib/cfbFbisV2.js";
import { COLLEGE_MODELS } from "../functions/lib/collegeModels.js";
import CFB_FBIS_V2_ARTIFACT from "../data/models/cfb-fbis-v2.js";
import CFB_PLAYER_V1_ARTIFACT from "../data/models/cfb-player-v1.js";

describe("cfbFbisV2Fit ridge utilities", () => {
  it("recovers a known linear margin relationship under ridge", () => {
    const X = [];
    const y = [];
    for (let i = 0; i < 80; i++) {
      const base = (i - 40) / 5;
      const pass = ((i % 7) - 3) / 2;
      X.push([base, pass]);
      y.push(1.5 + 0.9 * base + 0.4 * pass);
    }
    const model = fitRidge(X, y, { lambda: 0.1, featureNames: ["base", "pass"] });
    assert.equal(model.ok, true);
    const pred = predictRidge(model, X);
    assert.ok(mae(y, pred) < 0.15);
  });

  it("tuneRidgeLambda prefers lower validation MAE", () => {
    const Xtr = [
      [1, 0],
      [2, 0],
      [3, 1],
      [4, 1],
      [5, 0],
      [6, 1],
    ];
    const ytr = [2, 4, 7, 9, 10, 13];
    const Xva = [
      [2.5, 0],
      [4.5, 1],
    ];
    const yva = [5, 10];
    const tuned = tuneRidgeLambda(Xtr, ytr, Xva, yva, [0.1, 1, 10, 100]);
    assert.ok(Number.isFinite(tuned.lambda));
    assert.ok(Number.isFinite(tuned.mae));
  });

  it("pairedBlockBootstrap returns CI for identical metrics at ~0", () => {
    const a = [1, 2, 3, 4, 5, 6];
    const b = [1, 2, 3, 4, 5, 6];
    const blocks = [
      [0, 1],
      [2, 3],
      [4, 5],
    ];
    const out = pairedBlockBootstrap(a, b, blocks, { nBoot: 100, seed: 7 });
    assert.equal(out.nBoot, 100);
    assert.ok(Math.abs(out.mean) < 1e-9);
    assert.equal(out.ci95[0], 0);
    assert.equal(out.ci95[1], 0);
  });

  it("rowToMarginX / rowToTotalX honor nulls", () => {
    const row = {
      marginFeatures: { base: 3, pass: null, rush: 1 },
      totalFeatures: { base_total: 50, pass_total: null },
    };
    assert.deepEqual(rowToMarginX(row, ["base", "pass", "rush"]), [3, null, 1]);
    assert.deepEqual(rowToTotalX(row, ["base_total", "pass_total"]), [50, null]);
  });

  it("scoreMetrics exposes explicit bias sign convention", () => {
    const m = scoreMetrics({
      actualMargin: [0, 0],
      predMargin: [2, 4],
      actualTotal: [40, 50],
      predTotal: [42, 48],
      actualHome: [20, 25],
      predHome: [22, 26],
      actualAway: [20, 25],
      predAway: [20, 22],
      pHome: [0.6, 0.7],
      homeWon: [1, 0],
      marginSigma: [16, 16],
    });
    assert.equal(m.n, 2);
    assert.equal(m.biasMargin, 3);
    assert.match(m.biasSignConvention, /predMargin - actualMargin/);
  });

  it("pHomeWinFromMargin is monotone in margin", () => {
    assert.ok(pHomeWinFromMargin(10) > pHomeWinFromMargin(0));
    assert.ok(pHomeWinFromMargin(0) > pHomeWinFromMargin(-10));
  });

  it("ABLATION J and K feature sets are identical; mean/variance helpers work", () => {
    assert.deepEqual(ABLATION_FEATURE_SETS.J, ABLATION_FEATURE_SETS.K);
    assert.deepEqual(TOTAL_FEATURE_SETS.J, TOTAL_FEATURE_SETS.K);
    assert.deepEqual(ABLATION_MASKS.J, ABLATION_MASKS.K);
    assert.equal(mean([1, 2, 3]), 2);
    assert.ok(variance([1, 2, 3]) > 0);
  });
});

describe("CFB shadow models remain non-qualifying after calibration", () => {
  it("keeps CFB-FBIS-v2 and CFB-PLAYER-v1 canQualify false", () => {
    assert.equal(COLLEGE_MODELS[CFB_FBIS_V2_ID].canQualify, false);
    assert.equal(COLLEGE_MODELS["CFB-PLAYER-v1"].canQualify, false);
    assert.equal(CFB_FBIS_V2_ARTIFACT.canQualify, false);
    assert.equal(CFB_PLAYER_V1_ARTIFACT.canQualify, false);
  });
});
