import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeKenpomRatingRows,
  normalizeKenpomPointDistRows,
  normalizeKenpomHeightRows,
  normalizeKenpomMiscRows,
} from "../functions/lib/kenpomCbb.js";

describe("expanded KenPom CBB normalization", () => {
  it("retains possession length from ratings", () => {
    const [r] = normalizeKenpomRatingRows([{TeamName:"Houston",AdjOE:120,AdjDE:90,AdjTempo:64,APL_Off:17.2,APL_Def:18.8}]);
    assert.equal(r.aplOff,17.2);
    assert.equal(r.aplDef,18.8);
  });
  it("normalizes point distribution percentages", () => {
    const [r] = normalizeKenpomPointDistRows([{TeamName:"Houston",OffFt:18.5,OffFg2:52.5,OffFg3:29,DefFt:20,DefFg2:50,DefFg3:30}]);
    assert.equal(r.pointsFromFt,0.185);
    assert.equal(r.pointsFrom3,0.29);
    assert.equal(r.pointsAllowed2,0.5);
  });
  it("retains height, experience, bench and continuity", () => {
    const [r] = normalizeKenpomHeightRows([{TeamName:"Houston",AvgHgt:77.1,HgtEff:79.4,Exp:2.4,Bench:31.2,Continuity:67.5}]);
    assert.equal(r.effectiveHeight,79.4);
    assert.equal(r.experience,2.4);
    assert.equal(r.bench,31.2);
    assert.equal(r.continuity,67.5);
  });
  it("normalizes misc shooting and creation features", () => {
    const [r] = normalizeKenpomMiscRows([{TeamName:"Houston",FG3Pct:38,FG2Pct:56,F3GRate:41,ARate:61,OppFG3Pct:29,OppFG2Pct:45}]);
    assert.equal(r.threePtPct,0.38);
    assert.equal(r.twoPtPct,0.56);
    assert.equal(r.threePtAttemptRate,0.41);
    assert.equal(r.assistRate,0.61);
    assert.equal(r.oppThreePtPct,0.29);
  });
});
