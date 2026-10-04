import test from "node:test";
import assert from "node:assert/strict";
import { projectNflProV2 } from "../functions/lib/nflProV2Model.js";

function team(overrides={}){
  return {offenseEpa:.08,defenseEpa:-.03,successRate:.45,successRateAllowed:.40,earlyDownEpa:.06,earlyDownEpaAllowed:-.02,qbEpa:.15,qbCpoe:3,qbSackRate:.05,passEpa:.12,passEpaAllowed:.02,rushEpa:.03,rushEpaAllowed:-.01,pressureRate:.28,pressureRateAllowed:.22,specialTeamsEpa:.03,rushYoePerAtt:.35,rushEfficiency:3.2,receivingSeparation:3.1,receivingYacOe:.25,qbNgsCpoe:2.5,restDays:7,...overrides};
}
test("v2 stays independent and research-only",()=>{
  const p=projectNflProV2({nflFeatures:{home:team(),away:team({offenseEpa:.02,qbEpa:.08})}});
  assert.equal(p.ok,true);assert.equal(p.modelId,"NFL-PRO-v2");assert.equal(p.canQualify,false);assert.equal(p.marketInformed,false);assert.equal(p.provenance.marketUsed,false);
});
test("missing advanced families widen uncertainty",()=>{
  const full=projectNflProV2({nflFeatures:{home:team(),away:team()}});
  const sparse=projectNflProV2({nflFeatures:{home:team({rushYoePerAtt:null,receivingSeparation:null,receivingYacOe:null,pressureRateAllowed:null}),away:team({rushYoePerAtt:null,receivingSeparation:null,receivingYacOe:null,pressureRateAllowed:null})}});
  assert.ok(sparse.advancedCoverage.share<full.advancedCoverage.share);
  assert.ok(sparse.sigmaMargin>=full.sigmaMargin);
});
test("configured availability changes score; unconfigured does not",()=>{
  const g={nflFeatures:{home:team(),away:team()}};
  const raw=projectNflProV2(g);
  const none=projectNflProV2({...g,availabilityImpact:{configured:false,homeScoreAdjustment:-3,awayScoreAdjustment:0}});
  const hit=projectNflProV2({...g,availabilityImpact:{configured:true,homeScoreAdjustment:-2,awayScoreAdjustment:0}});
  assert.equal(none.home,raw.home);assert.ok(hit.home<raw.home);
});
