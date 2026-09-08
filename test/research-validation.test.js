import test from "node:test";
import assert from "node:assert/strict";

import { researchModelIds, temporalValidationFolds, cutoffLeakageOk } from "../functions/lib/collegeJobs.js";

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
  const rows = Array.from({ length: 12 }, (_, i) => ({
    frozen_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    actual_home: 70,
    actual_away: 65,
    cutoff_ok: 1,
  }));
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
