import test from "node:test";
import assert from "node:assert/strict";
import { buildNbaWagerDecision, summarizeActionForDecision, deriveNbaMarketTrajectory } from "../functions/lib/nbaWagerDecision.js";

const projection={
  ok:true,modelId:"NBA-FBIS-v1",modelVersion:"research-v1.1-calibrated",
  home:118,away:110,margin:8,total:228,expectedPossessions:100,
  pHomeWin:.72,sigmaMargin:12,sigmaTotal:16,
  decomposition:{
    home:{off:119,def:112,pace:101,efg:.57,tov:.12,orb:.27,ftr:.22},
    away:{off:113,def:116,pace:99,efg:.53,tov:.14,orb:.24,ftr:.19},
    homeRest:{pts:0,pace:0},awayRest:{pts:-1.1,pace:-.8},
    homeAvailability:{points:0,unc:0},awayAvailability:{points:-1.5,unc:.5},hca:2.2
  }
};

test("ACTION cannot directly qualify or authorize an NBA decision",()=>{
  const action=summarizeActionForDecision([{
    market_type:"spread",selection:"HOME",line:-4,
    provider_timestamp:"2026-10-04T15:59:00Z",collected_at:"2026-10-04T15:59:00Z",
    public_ticket_pct:42,public_money_pct:65,snapshot_type:"CURRENT"
  }],{decisionAt:"2026-10-04T16:00:00Z",marketType:"spread",side:"HOME",fbisDirection:"HOME_OR_OVER"});
  assert.equal(action.available,true);
  assert.equal(action.canDirectlyQualify,false);
  assert.equal(action.canAuthorize,false);
});

test("market trajectory uses only observations at or before decision time",()=>{
  const t=deriveNbaMarketTrajectory([
    {marketType:"spread",side:"HOME",line:-2,price:-110,observedAt:"2026-10-04T12:00:00Z",snapshotType:"OPEN"},
    {marketType:"spread",side:"HOME",line:-3,price:-110,observedAt:"2026-10-04T15:00:00Z"},
    {marketType:"spread",side:"HOME",line:-6,price:-110,observedAt:"2026-10-04T18:00:00Z",snapshotType:"CLOSE"}
  ],{marketType:"spread",side:"HOME",projectionValue:-5,decisionAt:"2026-10-04T16:00:00Z"});
  assert.equal(t.points,2);
  assert.equal(t.current.line,-3);
});

test("game-level decision prices EV from actual juice and keeps staking locked",()=>{
  const d=buildNbaWagerDecision({
    projection,
    offer:{marketType:"spread",side:"HOME",line:-4.5,price:-110,preTip:true,pairedMarket:true},
    trajectoryRows:[
      {marketType:"spread",side:"HOME",line:-3.5,price:-110,observedAt:"2026-10-04T12:00:00Z",snapshotType:"OPEN"},
      {marketType:"spread",side:"HOME",line:-4.5,price:-110,observedAt:"2026-10-04T16:00:00Z"}
    ],
    actionRows:[{
      market_type:"spread",selection:"HOME",line:-4.5,
      provider_timestamp:"2026-10-04T15:30:00Z",
      public_ticket_pct:40,public_money_pct:64,snapshot_type:"CURRENT"
    }],
    matchupReliability:.75,dataQuality:.9,historicalReliability:.65,
    decisionAt:"2026-10-04T16:00:00Z"
  });
  assert.equal(d.ok,true);
  assert.equal(d.safeguards.independentProjectionMarketFree,true);
  assert.equal(d.safeguards.actionDirectQualifier,false);
  assert.equal(d.stakeUnits,null);
  assert.equal(d.stakeStatus,"UNVALIDATED");
  assert.ok(d.breakEvenProbability>.52&&d.breakEvenProbability<.53);
  assert.ok(d.modelProbability>d.breakEvenProbability);
});

test("confidence cannot drive staking until monotonic calibration passes",()=>{
  const d=buildNbaWagerDecision({
    projection,
    offer:{marketType:"ml",side:"HOME",price:-150,preTip:true,pairedMarket:true},
    matchupReliability:.8,dataQuality:.9,historicalReliability:.7,
    confidenceCalibration:{sampleN:20,monotonicityPass:false}
  });
  assert.equal(d.confidence.status,"PROVISIONAL");
  assert.equal(d.confidence.decisionEligible,false);
});
