import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyFittedProjection,
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
    sport:"cfb",
    home:{name:"Alabama",school:"Alabama"},
    away:{name:"Auburn",school:"Auburn"},
    featureCutoffOk:true,
    cfbFbisV2Input:{
      home:{
        priorOff:35,priorDef:18,gamesPlayed:8,offensePpa:0.18,defensePpa:-0.10,
        passEpa:0.20,rushEpa:0.10,passEpaAllowed:-0.08,rushEpaAllowed:-0.05,
        successRate:0.45,successRateAllowed:0.36,explosiveRate:1.2,explosiveRateAllowed:0.9,
        havocRate:0.18,havocAllowed:0.10,lineYards:3.4,lineYardsAllowed:2.6,
        pointsPerOpportunity:4.8,pointsPerOpportunityAllowed:3.1,paceNorm:0.1,qbPpa:0.22
      },
      away:{
        priorOff:28,priorDef:22,gamesPlayed:8,offensePpa:0.04,defensePpa:0.02,
        passEpa:0.05,rushEpa:-0.05,passEpaAllowed:0.07,rushEpaAllowed:0.03,
        successRate:0.40,successRateAllowed:0.42,explosiveRate:1.0,explosiveRateAllowed:1.1,
        havocRate:0.13,havocAllowed:0.15,lineYards:2.8,lineYardsAllowed:3.1,
        pointsPerOpportunity:3.5,pointsPerOpportunityAllowed:4.0,paceNorm:-0.2,qbPpa:0.05
      }
    }
  };
}

describe("CFB-FBIS-v2 fitted production cutover",()=>{
  it("package matches target-specific final selection and fold3 coefficients",()=>{
    assert.equal(FITTED.Mstar,FINAL.Mstar);
    assert.equal(FITTED.Tstar,FINAL.Tstar);
    const m=FINAL.coefByFold.fold3[FINAL.Mstar];
    const t=FINAL.coefByFold.fold3[FINAL.Tstar];
    assert.deepEqual(FITTED.margin.features,m.margin.features);
    assert.deepEqual(FITTED.margin.beta,m.margin.beta);
    assert.equal(FITTED.margin.intercept,m.margin.intercept);
    assert.deepEqual(FITTED.total.features,t.total.features);
    assert.deepEqual(FITTED.total.beta,t.total.beta);
    assert.equal(FITTED.total.intercept,t.total.intercept);
    const sha=createHash("sha256").update(readFileSync("data/cfbd/calibration/fitted-coefficients-final.json")).digest("hex");
    assert.equal(FITTED.sourceArtifacts.fittedCoefficientsFinalSha256,sha);
    assert.equal(FITTED.featureContract,"ppa-derived-base-v2");
    assert.equal(FITTED.canQualify,false);
    assert.equal(FITTED.canAuthorize,false);
  });

  it("uses PPA-derived base and selected feature vectors coherently",()=>{
    const game=sampleGame();
    const provisional=projectCfbFbisV2(game,{ablation:"K"});
    assert.equal(provisional.ok,true);
    assert.ok(Number.isFinite(provisional.decomposition.BASE_TOTAL));
    const fitted=applyFittedProjection(provisional,game);
    assert.equal(fitted.ok,true);
    assert.equal(fitted.fittedApplied,true);
    assert.equal(fitted.Mstar,FITTED.Mstar);
    assert.equal(fitted.Tstar,FITTED.Tstar);
    assert.deepEqual(Object.keys(fitted.marginFeatures),FITTED.margin.features);
    assert.deepEqual(Object.keys(fitted.totalFeatures),FITTED.total.features);
    assert.ok(Math.abs(fitted.home-(fitted.total+fitted.margin)/2)<0.2);
    assert.ok(Math.abs(fitted.away-(fitted.total-fitted.margin)/2)<0.2);
    assert.equal(fitted.provenance.trainingServingContract,"ppa-derived-base-v2");
  });

  it("promotes fitted scores while blocking qualification",()=>{
    const projection=projectCfbFbisV2Production(sampleGame());
    const {games,meta}=promoteCfbFbisV2ToBoard([
      {sport:"cfb",projHomeScore:1,projAwayScore:1,cfbFbisV2:projection,cfb:{bettingAllowed:true}}
    ]);
    assert.equal(meta.promoted,1);
    assert.equal(meta.canQualify,false);
    assert.equal(games[0].projHomeScore,projection.home);
    assert.equal(games[0].projAwayScore,projection.away);
    assert.equal(games[0].modelVersion,CFB_FBIS_V2_ID);
    assert.equal(games[0].qualificationBlocked,true);
    assert.equal(games[0].cfb.bettingAllowed,false);
    assert.deepEqual(games[0].projectionArchitecture,{Mstar:FITTED.Mstar,Tstar:FITTED.Tstar});
  });
});
