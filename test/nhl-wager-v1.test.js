import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateNhlGameWagers,evaluateNhlPropWagerV1,deriveNhlMarketTrajectory,
  decomposeNhlProjectionDisagreement,validateNhlConfidenceCalibration
} from "../functions/lib/nhlWagerV1.js";

const goodCalibration={validated:true,minEv:.02,minProbabilityEdge:.01,minConfidence:60,bins:[
  {min:0,max:49,n:40,winRate:.45,roi:-.05,calibratedScore:42},
  {min:50,max:69,n:40,winRate:.55,roi:.02,calibratedScore:62},
  {min:70,max:100,n:40,winRate:.64,roi:.08,calibratedScore:82},
]};
function game(){
  return {id:"nhl-test",sport:"nhl",start:"2026-10-10T00:00:00Z",home:{abbr:"BOS"},away:{abbr:"NYR"},quality:{score:90},
    odds:{pinHomeMl:-120,pinAwayMl:110,pinSpread:-1.5,pinSpreadHomePrice:175,pinSpreadAwayPrice:-195,pinTotal:6,pinOverPrice:-105,pinUnderPrice:-105},
    nhlProV2:{ok:true,home:"BOS",away:"NYR",projHome:3.7,projAway:2.5,margin:1.2,total:6.2,
      probability:{homeWinIncludingOt:.64,awayWinIncludingOt:.36},
      layers:{eventChainXg:{home:2.8,away:2.3},goalie:{home:{impactPerShot:.004,reliability:.85},away:{impactPerShot:-.003,reliability:.8}},
        finishing:{home:{factor:1.05},away:{factor:.98}},specialTeams:{home:.1,away:-.02},
        tracking:{home:{goals:.04},away:{goals:-.01},playerEdgeCoverage:.7,player:{home:{differential:{maxSkatingSpeed:1,maxShotSpeed:2,highDangerShots:3}}}},
        situation:{homeRestDays:2,awayRestDays:0,eloGoalAdjustment:.12}}},
    marketLineHistory:[
      {market:"spread",selection:"home",line:-1,americanPrice:-110,collectedAt:"2026-10-08T12:00:00Z"},
      {market:"spread",selection:"home",line:-1.5,americanPrice:175,collectedAt:"2026-10-09T20:00:00Z"},
      {market:"total",selection:"over",line:5.5,americanPrice:-110,collectedAt:"2026-10-08T12:00:00Z"},
      {market:"total",selection:"over",line:6,americanPrice:-105,collectedAt:"2026-10-09T20:00:00Z"}],
    actionIntel:{publicSplits:{markets:[{market:"TOTAL",ticketPct:50,moneyPct:62,moneyTicketGap:12}]},lineHistory:[]}};
}
test("NHL confidence calibration is fail-closed and monotonic",()=>{
  assert.equal(validateNhlConfidenceCalibration({validated:false,bins:[]}).ok,false);
  assert.equal(validateNhlConfidenceCalibration({validated:true,bins:[
    {min:0,max:49,n:30,winRate:.5,roi:.02},{min:50,max:79,n:30,winRate:.6,roi:.04},{min:80,max:100,n:30,winRate:.55,roi:.05}
  ]}).ok,false);
  assert.equal(validateNhlConfidenceCalibration(goodCalibration).ok,true);
});
test("positive raw EV can qualify before confidence validation while staking stays disabled",()=>{
  const out=evaluateNhlGameWagers(game());
  assert.equal(out.ok,true);
  assert.equal(out.offers.length,6);
  assert.equal(out.decision,"BET");
  assert.ok(out.offers.some(x=>x.researchCandidate));
  assert.ok(out.offers.some(x=>x.canQualify===true));
  assert.equal(out.canQualify,true);
  assert.equal(out.canAuthorizeWager,false);
  assert.ok(out.offers.every(x=>x.stakingValidated===false));
});
test("validated confidence can authorize decision label but never staking yet",()=>{
  const out=evaluateNhlGameWagers(game(),goodCalibration);
  assert.ok(out.offers.some(x=>x.decision==="BET"));
  assert.ok(out.offers.filter(x=>x.decision==="BET").every(x=>x.stakingValidated===false&&x.stakeUnits==null));
});
test("market trajectory and disagreement never mutate projection",()=>{
  const g=game(),before=JSON.stringify(g.nhlProV2);
  const t=deriveNhlMarketTrajectory({lineHistory:[
    {market:"total",selection:"over",line:5.5,collectedAt:"2026-10-08T10:00:00Z"},
    {market:"total",selection:"over",line:6,collectedAt:"2026-10-08T16:00:00Z"},
    {market:"total",selection:"over",line:5.5,collectedAt:"2026-10-08T22:00:00Z"}
  ]},{market:"total",selection:"over",fbisSide:"OVER"});
  assert.equal(t.reversal,true);
  assert.ok(decomposeNhlProjectionDisagreement(g).factors.some(x=>x.factor==="goalie"));
  evaluateNhlGameWagers(g);
  assert.equal(JSON.stringify(g.nhlProV2),before);
});
test("NHL validated props can qualify before confidence staking calibration",()=>{
  const row={sport:"nhl",marketCanonical:"shots_on_goal",fbisProjection:4.5,line:3.5,probabilityOver:.68,probabilityUnder:.32,
    overOdds:-115,underOdds:-105,validationStatus:"PROMOTE_RESEARCH",lineValidationStatus:"PROMOTE_RESEARCH",
    propGate:"CLEAR",eligibleForCard:true,trackingAdvisory:{coverage:.7},roleConfidence:.9};
  const raw=evaluateNhlPropWagerV1(row);
  assert.equal(raw.decision,"BET");assert.equal(raw.researchCandidate,true);assert.equal(raw.canQualify,true);assert.equal(raw.canAuthorizeWager,false);
  const calibrated=evaluateNhlPropWagerV1(row,goodCalibration);
  assert.equal(calibrated.confidenceValidated,true);
  assert.equal(calibrated.stakingValidated,false);
});
