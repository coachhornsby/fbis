import test from "node:test";
import assert from "node:assert/strict";

import { researchModelIds, temporalValidationFolds, cutoffLeakageOk } from "../functions/lib/collegeJobs.js";
import { evaluatePromotionEvidence } from "../functions/lib/collegeModels.js";
import { promotionEvidence } from "../functions/lib/modelLab.js";

test("college validation selects independent score models by sport", () => {
  const cbb = researchModelIds("cbb");
  const cfb = researchModelIds("cfb");
  assert.ok(cbb.includes("CBB-CBBD-RATINGS-v1"));
  assert.ok(cbb.includes("CBB-MATCHUP-v1"));
  assert.ok(!cbb.includes("CBB-PINNACLE-IMPLIED"));
  assert.ok(!cbb.includes("CBB-MARKET-SHRUNK-v1"));
  assert.ok(cfb.includes("CFB-CFBD-RATINGS-v1"));
  assert.ok(!cfb.includes("CFB-PINNACLE-IMPLIED"));
});

test("rolling validation never trains on or after its validation block", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ frozen_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), actual_home: 70, actual_away: 65, cutoff_ok: 1 }));
  const folds = temporalValidationFolds(rows, 4);
  assert.equal(folds.length, 3);
  for (const fold of folds) {
    const maxTrain = Math.max(...fold.train.map((r) => Date.parse(r.frozen_at)));
    const minValidate = Math.min(...fold.validate.map((r) => Date.parse(r.frozen_at)));
    assert.ok(maxTrain < minValidate);
  }
});

test("leakage audit fails closed when cutoff evidence is absent", () => {
  assert.equal(cutoffLeakageOk([]), false);
  assert.equal(cutoffLeakageOk([{ cutoff_ok: 1 }, { cutoff_ok: 1 }]), true);
  assert.equal(cutoffLeakageOk([{ cutoff_ok: 1 }, {}]), false);
  assert.equal(cutoffLeakageOk([{ cutoff_ok: 0 }]), false);
});

test("promotion evidence is paired and includes probability calibration", () => {
  const ref = [];
  const challenger = [];
  for (let i = 0; i < 6; i += 1) {
    const season = 2024 + Math.floor(i / 2);
    const actualHome = 75 + i;
    const actualAway = 70;
    ref.push({ game_id: `g${i}`, sport: "cbb", season, frozen_at: `${season}-01-01T00:00:00Z`, actual_home: actualHome, actual_away: actualAway, proj_home: actualHome + 3, proj_away: actualAway - 2, p_home_win: 0.58 });
    challenger.push({ game_id: `g${i}`, sport: "cbb", season, frozen_at: `${season}-01-01T00:00:00Z`, actual_home: actualHome, actual_away: actualAway, proj_home: actualHome + 1, proj_away: actualAway, p_home_win: 0.68 });
  }
  const e = promotionEvidence(ref, challenger, { sport: "cbb", leakageOk: true, artifactOk: true });
  assert.equal(e.n, 6);
  assert.equal(e.seasons, 3);
  assert.ok(e.maeImprovement > 0);
  assert.equal(e.leakageOk, true);
  assert.equal(e.artifactOk, true);
  assert.ok(Number.isFinite(e.brierDegradation));
});

test("full promotion gate enforces every predeclared criterion", () => {
  const pass = evaluatePromotionEvidence({ n: 500, seasons: 3, maeImprovement: 0.2, biasAbs: 0.5, brierDegradation: 0.01, coverage: 0.95, leakageOk: true, artifactOk: true, operatorApproved: true });
  assert.equal(pass.promote, true);
  const fail = evaluatePromotionEvidence({ n: 500, seasons: 2, maeImprovement: 0.1, biasAbs: 2, brierDegradation: 0.03, coverage: 0.8, leakageOk: false, artifactOk: false, operatorApproved: false });
  assert.equal(fail.promote, false);
  assert.ok(fail.fail.includes("coverage"));
  assert.ok(fail.fail.includes("operator-approval-required"));
});
