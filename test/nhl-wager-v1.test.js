import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateNhlGameWagers,evaluateNhlPropWagerV1,deriveNhlMarketTrajectory,
  decomposeNhlProjectionDisagreement,validateNhlConfidenceCalibration,verifyNhlFullGameMoneylineQuote
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
test("positive provisional EV remains research-only without verified quote, scope and probability calibration",()=>{
  const out=evaluateNhlGameWagers(game());
  assert.equal(out.ok,true);
  assert.equal(out.offers.length,6);
  assert.equal(out.decision,"PASS");
  assert.ok(out.offers.some(x=>x.researchCandidate));
  assert.ok(out.offers.every(x=>x.canQualify===false));
  assert.equal(out.canQualify,false);
  assert.ok(out.offers.filter(x=>x.market==="moneyline").every(x=>x.modelProbability===null));
  assert.ok(out.offers.every(x=>x.probabilityStatus==="RESEARCH_PROVISIONAL_SHRINK_NOT_VALIDATED"));
  assert.equal(out.canAuthorizeWager,false);
  assert.ok(out.offers.every(x=>x.stakingValidated===false));
});
test("validated confidence alone does not qualify execution decisions",()=>{
  const out=evaluateNhlGameWagers(game(),goodCalibration);
  assert.ok(out.offers.every(x=>x.decision==="PASS"));
  assert.equal(out.canQualify,false);
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

test("unverified regulation distribution cannot silently substitute for full-game moneyline",()=>{
  const g=game();
  delete g.nhlProV2.probability;
  const out=evaluateNhlGameWagers(g,goodCalibration);
  assert.equal(out.ok,true);
  assert.equal(out.offers.filter(x=>x.market==="moneyline").length,2);
  assert.ok(out.offers.filter(x=>x.market==="moneyline").every(x=>x.modelProbability==null&&x.expectedValue==null));
  assert.equal(out.canQualify,false);
});
test("inconsistent complement and reversed teams block moneyline research EV",()=>{
  const g=game();
  g.nhlProV2.probability.awayWinIncludingOt=.8;
  const out=evaluateNhlGameWagers(g,goodCalibration);
  assert.equal(out.moneylineIntegrity.ok,false);
  assert.ok(out.offers.filter(x=>x.market==="moneyline").every(x=>x.expectedValue==null));
  const r=game();
  r.nhlProV2.home="NYR";
  assert.ok(evaluateNhlGameWagers(r).moneylineIntegrity.reasons.includes("HOME_AWAY_IDENTITY_MISMATCH"));
});
test("same-book, same-time, pre-start full-game quotes are required",()=>{
  const g=game(),date="2026-10-09T20:00:00Z";
  g.odds.moneylineMarketScope="FULL_GAME_INCLUDING_OT_SHOOTOUT";
  g.marketLineHistory=[
    {market:"ml",selection:"home",americanPrice:-120,collectedAt:date,sportsbook:"book-a",source:"ODDS_SNAPSHOT"},
    {market:"ml",selection:"away",americanPrice:110,collectedAt:date,sportsbook:"book-a",source:"ODDS_SNAPSHOT"}
  ];
  const q=verifyNhlFullGameMoneylineQuote(g,{homeMl:-120,awayMl:110});
  assert.equal(q.ok,true);
  assert.equal(q.book,"book-a");
  g.marketLineHistory[1].sportsbook="book-b";
  assert.equal(verifyNhlFullGameMoneylineQuote(g,{homeMl:-120,awayMl:110}).ok,false);
  g.marketLineHistory[1].sportsbook="book-a";
  g.marketLineHistory[1].collectedAt="2026-10-09T21:00:00Z";
  assert.equal(verifyNhlFullGameMoneylineQuote(g,{homeMl:-120,awayMl:110}).ok,false);
});
test("OT-unsafe spread and totals are never qualified with regulation distribution",()=>{
  const out=evaluateNhlGameWagers(game(),goodCalibration);
  const nonMl=out.offers.filter(x=>x.market==="spread"||x.market==="total");
  assert.equal(nonMl.length,4);
  assert.ok(nonMl.every(x=>!x.canQualify&&x.reasons.includes("settlement-market-scope-unverified")));
});
