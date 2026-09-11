import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyFittedAaProjection,
  projectCfbFbisV2,
  projectCfbFbisV2Production,
  promoteCfbFbisV2ToBoard,
  CFB_FBIS_V2_ID,
} from "../functions/lib/cfbFbisV2.js";
import FITTED from "../data/models/cfb-fbis-v2-fitted-aa.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const FINAL = JSON.parse(readFileSync("data/cfbd/calibration/fitted-coefficients-final.json", "utf8"));

function sampleGame() {
  return {
    sport: "cfb",
    home: { name: "Alabama", school: "Alabama" },
    away: { name: "Auburn", school: "Auburn" },
    featureCutoffOk: true,
    cfbFbisV2Input: {
      home: {
        priorOff: 35,
        priorDef: 18,
        off: 34,
        def: 17,
        gamesPlayed: 8,
        passEpa: 0.2,
        rushEpa: 0.1,
        successRate: 0.45,
      },
      away: {
        priorOff: 28,
        priorDef: 22,
        off: 27,
        def: 21,
        gamesPlayed: 8,
        passEpa: 0.05,
        rushEpa: -0.05,
        successRate: 0.4,
      },
    },
  };
}

describe("CFB-FBIS-v2 fitted A/A production cutover", () => {
  it("keeps final M*/T* selection and coefficient betas unchanged", () => {
    assert.equal(FINAL.Mstar, "A");
    assert.equal(FINAL.Tstar, "A");
    assert.equal(FITTED.Mstar, "A");
    assert.equal(FITTED.Tstar, "A");
    const a = FINAL.coefByFold.fold3.A;
    assert.deepEqual(FITTED.margin.beta, a.margin.beta);
    assert.equal(FITTED.margin.intercept, a.margin.intercept);
    assert.deepEqual(FITTED.total.beta, a.total.beta);
    assert.equal(FITTED.total.intercept, a.total.intercept);
    const sha = createHash("sha256").update(readFileSync("data/cfbd/calibration/fitted-coefficients-final.json")).digest("hex");
    assert.equal(sha, "72c9e935dafc9e1cd0a4e0e2655d21238367bd90b9af143f5cdd51e2b722cabc");
    assert.equal(FITTED.canQualify, false);
    assert.equal(FITTED.canAuthorize, false);
  });

  it("applies coherent score reconstruction from fitted margin/total", () => {
    const provisional = projectCfbFbisV2(sampleGame(), { ablation: "K" });
    assert.equal(provisional.ok, true);
    const fitted = applyFittedAaProjection(provisional, sampleGame());
    assert.equal(fitted.ok, true);
    assert.equal(fitted.fittedApplied, true);
    assert.equal(fitted.Mstar, "A");
    assert.equal(fitted.Tstar, "A");
    assert.equal(fitted.canQualify, false);
    assert.equal(fitted.canAuthorize, false);
    assert.ok(Math.abs(fitted.home - (fitted.total + fitted.margin) / 2) < 0.2);
    assert.ok(Math.abs(fitted.away - (fitted.total - fitted.margin) / 2) < 0.2);
    assert.ok(Math.abs((fitted.home - fitted.away) - fitted.margin) < 0.2);
  });

  it("promotes fitted scores to the board while blocking qualification", () => {
    const projection = projectCfbFbisV2Production(sampleGame());
    const { games, meta } = promoteCfbFbisV2ToBoard([
      { sport: "cfb", projHomeScore: 1, projAwayScore: 1, cfbFbisV2: projection, cfb: { bettingAllowed: true } },
    ]);
    assert.equal(meta.promoted, 1);
    assert.equal(meta.canQualify, false);
    assert.equal(games[0].projHomeScore, projection.home);
    assert.equal(games[0].projAwayScore, projection.away);
    assert.equal(games[0].modelVersion, CFB_FBIS_V2_ID);
    assert.equal(games[0].qualificationBlocked, true);
    assert.equal(games[0].cfb.bettingAllowed, false);
    assert.deepEqual(games[0].projectionArchitecture, { Mstar: "A", Tstar: "A" });
  });
});
