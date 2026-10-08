import test from "node:test";
import assert from "node:assert/strict";
import {
  americanBreakEven,
  expectedValuePerUnitRisk,
  buildNflWagerIntelligence as intelligenceAtClock,
  evaluateNflGameWagers as evaluateAtClock,
  validateConfidenceCalibration,
} from "../functions/lib/nflWagerDecision.js";

const decisionAt=Date.parse('2026-10-04T12:00:00Z');
const evaluateNflGameWagers=(g,c)=>evaluateAtClock(g,c,{decisionAt});
const buildNflWagerIntelligence=(g,p)=>intelligenceAtClock(g,p,{decisionAt});

const validatedCalibration = {
  validated:true,
  minEv:0.02,
  minProbabilityEdge:0.02,
  minConfidence:70,
  bins:[
    {min:0,max:59,n:100,winRate:.48,calibratedScore:45},
    {min:60,max:79,n:100,winRate:.56,calibratedScore:72},
    {min:80,max:100,n:100,winRate:.63,calibratedScore:88},
  ],
};

function game(overrides={}){
  return {
    id:"nfl-test",
    sport:"nfl",
    home:{abbr:"HOU"},
    away:{abbr:"DAL"},
    nflProShadow:{
      ok:true,independent:true,marketInformed:false,modelId:"NFL-PRO-v1",version:"v1.2",
      home:27,away:20,margin:7,total:47,sigmaMargin:10,sigmaTotal:11,
      coverage:{share:.9},
      decomposition:{
        home:{teamPower:1.1,qb:{value:.7},tracking:{value:.4},matchup:{pass:.5,rush:.2,explosive:.1,pressure:.3,trenches:.2},specialTeams:.1,context:.1,hfa:1.25},
        away:{teamPower:.2,qb:{value:.1},tracking:{value:.1},matchup:{pass:0,rush:0,explosive:0,pressure:0,trenches:0},specialTeams:0,context:0,hfa:-1.25},
      },
    },
    market:{
      executionActionable:true,
      execution:{
        available:true,actionable:true,book:"Heritage",spread:-2.5,total:44.5,
        spreadHomePrice:-105,spreadAwayPrice:-115,overPrice:-108,underPrice:-112,
      },
    },
    actionIntel:{
      provider:"ACTION_APIFY",historyAvailable:true,collectedAt:"2026-10-04T12:00:00Z",
      lineHistory:[
        {market:"spread",selection:"home",line:-1,americanPrice:-110,providerTimestamp:"2026-10-01T12:00:00Z",collectedAt:"2026-10-01T12:00:00Z"},
        {market:"spread",selection:"home",line:-2.5,americanPrice:-105,providerTimestamp:"2026-10-04T12:00:00Z",collectedAt:"2026-10-04T12:00:00Z"},
        {market:"total",selection:"over",line:43,americanPrice:-110,providerTimestamp:"2026-10-01T12:00:00Z",collectedAt:"2026-10-01T12:00:00Z"},
        {market:"total",selection:"over",line:44.5,americanPrice:-108,providerTimestamp:"2026-10-04T12:00:00Z",collectedAt:"2026-10-04T12:00:00Z"},
      ],
      publicSplits:{ticketPct:44,moneyPct:58},
      consensus:{spreadHome:-2.5,total:44.5},
      observedAt:"2026-10-04T12:00:00Z",
    },
    quality:{score:90},
    availabilityImpact:{configured:true,criticalUnresolved:false,stale:false,homeScoreAdjustment:0,awayScoreAdjustment:0},
    ...overrides,
  };
}

test("American break-even and EV use actual offered price",()=>{
  assert.ok(Math.abs(americanBreakEven(-110)-.5238095)<1e-6);
  assert.ok(expectedValuePerUnitRisk(.56,-110)>0);
  assert.ok(expectedValuePerUnitRisk(.50,-110)<0);
});

test("confidence validation rejects non-monotonic bins",()=>{
  const bad={validated:true,bins:[
    {min:0,max:49,n:30,winRate:.50},
    {min:50,max:79,n:30,winRate:.60},
    {min:80,max:100,n:30,winRate:.55},
  ]};
  assert.equal(validateConfidenceCalibration(bad).ok,false);
  assert.equal(validateConfidenceCalibration(validatedCalibration).ok,true);
});

test("ACTION trajectory is point-in-time and excludes close from decision features",()=>{
  const intel=buildNflWagerIntelligence(game(),game().nflProShadow);
  assert.equal(intel.opening.spread,-1);
  assert.equal(intel.current.spread,-2.5);
  assert.equal(intel.movement.spreadDelta,-1.5);
  assert.equal(intel.public.divergencePct,14);
  assert.equal(intel.closeUsedAsDecisionInput,false);
  assert.equal(intel.actionMayCreateBet,false);
});

test("game-level decision prices each offered side/total and preserves independent projection",()=>{
  const out=evaluateNflGameWagers(game(),validatedCalibration);
  assert.equal(out.ok,true);
  assert.equal(out.independentProjection.marketInformed,false);
  assert.equal(out.closeUsedAsDecisionInput,false);
  assert.equal(out.candidates.length,4);
  assert.ok(out.candidates.every(c=>c.breakEvenProbability!=null));
  assert.ok(out.candidates.every(c=>c.americanPrice!=null));
  assert.ok(out.decomposition.some(x=>x.label==="QB"));
  assert.ok(out.decomposition.some(x=>x.label==="Injuries / availability"));
});

test("positive EV can qualify without calibrated confidence while staking stays disabled",()=>{
  const out=evaluateNflGameWagers(game(),{validated:false,bins:[],minEv:.01,minProbabilityEdge:.01,minConfidence:1});
  assert.equal(out.confidenceValidated,false);
  assert.equal(out.decision,"BET");
  assert.equal(out.canQualify,true);
  assert.equal(out.canAuthorizeWager,false);
  assert.equal(out.staking.validated,false);
  assert.ok(out.bestWager.reasons.includes("confidence-calibration-not-validated"));
});

test("ACTION confirmation cannot create a bet when independent EV is non-positive",()=>{
  const g=game({
    nflProShadow:{...game().nflProShadow,home:22,away:22,margin:0,total:44},
    // Every side must actually have non-positive EV for this assertion.
    market:{executionActionable:true,execution:{available:true,actionable:true,book:'Heritage',
      spread:0,total:44,spreadHomePrice:-110,spreadAwayPrice:-110,overPrice:-110,underPrice:-110}},
  });
  const out=evaluateNflGameWagers(g,validatedCalibration);
  assert.equal(out.bestWager.decision,"PASS");
  assert.ok((out.bestWager.expectedValuePerUnitRisk??0)<=0 || out.bestWager.probabilityEdge<.02);
});

test("missing actual price blocks betting instead of assuming -110",()=>{
  const g=game();
  g.market.execution.spreadHomePrice=null;
  g.market.execution.spreadAwayPrice=null;
  g.market.execution.overPrice=null;
  g.market.execution.underPrice=null;
  const out=evaluateNflGameWagers(g,validatedCalibration);
  assert.equal(out.decision,"PASS");
  assert.ok(out.candidates.every(c=>c.americanPrice==null));
  assert.ok(out.candidates.every(c=>c.reasons.includes("actual-price-missing")));
});


test("unconfigured availability is not mislabeled stale",()=>{
  const g=game({availabilityImpact:{configured:false,criticalUnresolved:false,stale:true,homeScoreAdjustment:0,awayScoreAdjustment:0}});
  const out=evaluateNflGameWagers(g,{validated:false,bins:[],minEv:.01,minProbabilityEdge:.01,minConfidence:1});
  assert.ok(out.candidates.every(c=>!c.reasons.includes("availability-stale")));
});
