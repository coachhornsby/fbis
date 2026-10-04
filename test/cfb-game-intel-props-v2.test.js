import test from "node:test"; import assert from "node:assert/strict";
import {americanBreakEven,buildCfbMarketTrajectory,scoreCfbGameOffer} from "../functions/lib/cfbGameWagerIntelligence.js";
import {cfbPropConfidence} from "../functions/lib/cfbPropConfidence.js";
test("minus 110 break even",()=>assert.ok(Math.abs(americanBreakEven(-110)-110/210)<1e-9));
test("trajectory is chronological and immutable-derived",()=>{const r=buildCfbMarketTrajectory([{observedAt:"2026-10-02T00:00:00Z",line:-4,moneyPct:60,ticketPct:40},{observedAt:"2026-10-01T00:00:00Z",line:-3,moneyPct:55,ticketPct:45}]);assert.equal(r[1].lineMoveFromOpen,-1);assert.equal(r[1].ticketMoneyDivergence,20)});
test("game offer returns EV and research candidate",()=>{const r=scoreCfbGameOffer({projectionMargin:-7,marketLine:-4,price:-110,calibratedWinProbability:.57,projectionUncertainty:10,dataQuality:.9,actionConfirmation:.5});assert.equal(r.ok,true);assert.ok(r.expectedValuePerUnit>0);assert.equal(r.decision,"RESEARCH_CANDIDATE")});
test("uncalibrated CFB prop cannot receive stars",()=>{const r=cfbPropConfidence({projection:100,line:80,dataQuality:1,roleConfidence:1});assert.equal(r.confidenceStars,null);assert.equal(r.wagerAuthority,false)});
test("calibrated CFB prop gets bounded stars but no automatic authority",()=>{const r=cfbPropConfidence({calibratedHitProbability:.59,breakEvenProbability:.52381,dataQuality:.9,roleConfidence:.9,validationN:250,validationRoi:.08});assert.ok(r.confidenceStars>=1&&r.confidenceStars<=5);assert.equal(r.validatedResearchSignal,true);assert.equal(r.wagerAuthority,false)});
