import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateNhlGameWagers,
  evaluateNhlPropWagerV1,
  deriveNhlMarketTrajectory,
  decomposeNhlProjectionDisagreement,
  summarizeNhlConfidenceMonotonicity,
} from "../functions/lib/nhlWagerV1.js";

function game(){
  return {
    id:"2026020001",sport:"nhl",start:"2026-10-10T00:00:00Z",
    home:{abbr:"BOS"},away:{abbr:"NYR"},
    odds:{
      pinHomeMl:-125,pinAwayMl:+110,
      pinSpread:-1.5,pinSpreadHomePrice:+170,pinSpreadAwayPrice:-195,
      pinTotal:6.0,pinOverPrice:-108,pinUnderPrice:-102,
    },
    quality:{score:88},
    nhlProV2:{
      ok:true,home:"BOS",away:"NYR",projHome:3.55,projAway:2.65,margin:.9,total:6.2,
      probability:{homeWinIncludingOt:.61,awayWinIncludingOt:.39},
      layers:{
        eventChainXg:{home:2.75,away:2.35},
        goalie:{home:{impactPerShot:.004,reliability:.82},away:{impactPerShot:-.003,reliability:.78}},
        finishing:{home:{factor:1.04},away:{factor:.98}},
        specialTeams:{home:.08,away:-.03},
        tracking:{
          home:{goals:.04},away:{goals:-.01},playerEdgeCoverage:.65,
          player:{home:{differential:{maxSkatingSpeed:1.2,maxShotSpeed:2.5,highDangerShots:3}}}
        },
        situation:{homeRestDays:2,awayRestDays:0,eloGoalAdjustment:.12}
      }
    },
    marketLineHistory:[
      {sportsbook:"Pinnacle",market:"moneyline",selection:"home",line:null,americanPrice:-115,collectedAt:"2026-10-08T13:00:00Z"},
      {sportsbook:"Pinnacle",market:"moneyline",selection:"home",line:null,americanPrice:-125,collectedAt:"2026-10-09T20:00:00Z"},
      {sportsbook:"Pinnacle",market:"total",selection:"over",line:5.5,americanPrice:-110,collectedAt:"2026-10-08T13:00:00Z"},
      {sportsbook:"Pinnacle",market:"total",selection:"over",line:6,americanPrice:-108,collectedAt:"2026-10-09T20:00:00Z"},
    ],
    actionIntel:{
      publicSplits:{markets:[
        {market:"ML",ticketPct:58,moneyPct:66,moneyTicketGap:8},
        {market:"TOTAL",ticketPct:51,moneyPct:61,moneyTicketGap:10},
      ]},
      lineHistory:[]
    }
  };
}

test("NHL-WAGER-v1 prices individual offers and never grants authority",()=>{
  const g=game(),before=JSON.stringify(g.nhlProV2);
  const out=evaluateNhlGameWagers(g);
  assert.equal(out.ok,true);
  assert.equal(out.offers.length,6);
  assert.ok(out.offers.every(x=>x.breakEvenProbability>0&&x.breakEvenProbability<1));
  assert.ok(out.offers.every(x=>x.expectedRoi==null||Number.isFinite(x.expectedRoi)));
  assert.ok(out.offers.every(x=>x.confidence>=0&&x.confidence<=100));
  assert.equal(out.canQualify,false);
  assert.equal(out.canAuthorizeWager,false);
  assert.ok(out.offers.every(x=>x.suggestedUnits===0));
  assert.equal(JSON.stringify(g.nhlProV2),before);
});

test("NHL trajectory preserves immutable movement and public split evidence",()=>{
  const t=deriveNhlMarketTrajectory({
    lineHistory:[
      {market:"total",selection:"over",line:5.5,americanPrice:-105,collectedAt:"2026-10-08T10:00:00Z"},
      {market:"total",selection:"over",line:6,americanPrice:-110,collectedAt:"2026-10-08T16:00:00Z"},
      {market:"total",selection:"over",line:5.5,americanPrice:-115,collectedAt:"2026-10-08T22:00:00Z"},
    ],
    publicSplits:{markets:[{market:"TOTAL",ticketPct:45,moneyPct:62,moneyTicketGap:17}]}
  },{market:"total",selection:"over",fbisSide:"OVER"});
  assert.equal(t.available,true);
  assert.equal(t.observations,3);
  assert.equal(t.reversal,true);
  assert.equal(t.ticketPct,45);
  assert.equal(t.moneyPct,62);
});

test("NHL disagreement decomposition exposes hockey-specific factors",()=>{
  const d=decomposeNhlProjectionDisagreement(game());
  const names=new Set(d.factors.map(x=>x.factor));
  for(const n of ["5v5/event-chain xG","goalie","finishing","special teams","team EDGE zone pressure","rest","elo/form"]) assert.equal(names.has(n),true);
  assert.equal(d.diagnosticApproximation,true);
});

test("NHL prop wager layer uses actual price and remains research only",()=>{
  const w=evaluateNhlPropWagerV1({
    sport:"nhl",marketCanonical:"shots_on_goal",fbisProjection:4.3,line:3.5,
    probabilityOver:.66,probabilityUnder:.34,overOdds:-120,underOdds:+100,
    validationStatus:"PROMOTE_RESEARCH",lineValidationStatus:"PROMOTE_RESEARCH",
    propGate:"CLEAR",eligibleForCard:true,trackingAdvisory:{coverage:.7},roleConfidence:.85
  });
  assert.equal(w.side,"OVER");
  assert.equal(w.americanPrice,-120);
  assert.ok(w.breakEvenProbability>.5);
  assert.ok(Number.isFinite(w.expectedRoi));
  assert.equal(w.canAuthorizeWager,false);
  assert.equal(w.suggestedUnits,0);
});

test("confidence audit groups settled evidence for monotonicity testing",()=>{
  const rows=[
    {confidence:55,profitUnits:-1,riskUnits:1},{confidence:55,profitUnits:1,riskUnits:1},
    {confidence:75,profitUnits:1,riskUnits:1},{confidence:75,profitUnits:1,riskUnits:1},
    {confidence:85,profitUnits:1,riskUnits:1},
  ];
  const out=summarizeNhlConfidenceMonotonicity(rows);
  assert.equal(out.find(x=>x.band==="70-79").roi,1);
  assert.equal(out.find(x=>x.band==="50-59").roi,0);
});
