import test from "node:test";
import assert from "node:assert/strict";
import { analyzeNflGameMatchup } from "../functions/lib/nflGameMatchup.js";

const base={ok:true,modelId:"NFL-PRO-v1",home:24,away:21,margin:3,total:45,sigmaMargin:13.8,sigmaTotal:12.8};
const full={
 sport:"nfl",nflFeatures:{
  home:{pressureRateAllowed:.22,pressureRate:.31,qbPressureEpa:-.05,rushEpa:.08,rushEpaAllowed:-.04,rushYoePerAtt:.5,receivingSeparation:3.2,receivingYacOe:.4,passEpaAllowed:-.03,explosiveRate:.14,explosiveRateAllowed:.09,earlyDownEpa:.10,earlyDownEpaAllowed:-.02},
  away:{pressureRateAllowed:.31,pressureRate:.24,qbPressureEpa:-.22,rushEpa:-.03,rushEpaAllowed:.06,rushYoePerAtt:-.2,receivingSeparation:2.7,receivingYacOe:-.2,passEpaAllowed:.08,explosiveRate:.09,explosiveRateAllowed:.14,earlyDownEpa:-.02,earlyDownEpaAllowed:.07}
 }};
test("NFL game matchup is market-free, capped, and auditable",()=>{
 const x=analyzeNflGameMatchup(full,base); assert.equal(x.ok,true);assert.equal(x.marketUsed,false);assert.equal(x.canQualify,false);
 assert.equal(x.signals.length,5);assert.equal(x.coverage.share,1);assert.equal(x.adjustment.evidenceQualified,true);
 assert.ok(Math.abs(x.adjustment.margin)<=2.5);assert.equal(x.final.total,base.total);
});
test("incomplete game evidence cannot alter baseline",()=>{
 const x=analyzeNflGameMatchup({sport:"nfl",nflFeatures:{home:{rushEpa:.1},away:{rushEpa:0}}},base);
 assert.equal(x.adjustment.evidenceQualified,false);assert.equal(x.adjustment.margin,0);assert.equal(x.final.margin,base.margin);
});
test("missing baseline fails closed",()=>assert.equal(analyzeNflGameMatchup(full,null).ok,false));
