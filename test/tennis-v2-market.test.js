import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTennisContext, tennisContextServeAdjustment, deriveCourtSpeedIndex } from "../functions/lib/tennisContextV2.js";
import { buildSharpMarketPrior, tennisMarketResidualProjection, deriveMarketMovementFeatures } from "../functions/lib/tennisMarketV2.js";
import { simulateTennisV2, simulateTennisMarketV2 } from "../functions/lib/tennisFbisV2.js";
import { buildActorInput } from "../functions/lib/actionApifyShadow.js";

const p=(name,serve=.64,ret=.36)=>({
  id:name,name,historyMatches:80,surfaceMatches:30,elo:1700,surfaceElo:{hard:1700},
  firstServeIn:.62,firstServeWin:.72,secondServeWin:.52,servePointWin:serve,
  aceRate:.075,doubleFaultRate:.035,bpSaveRate:.62,bpFacedPerServiceGame:.28,
  servicePointsPerGame:6.4,returnPointWin:ret,returnFirstWin:.28,returnSecondWin:.48,
  aceAllowedRate:.075,dfReceivedRate:.035,bpCreatePerReturnGame:.28,bpConvertRate:.38,surface:"hard"
});

test("tennis context remains explicit when missing",()=>{
  const c=normalizeTennisContext({});
  assert.equal(c.indoor,null);
  assert.equal(c.courtSpeedIndex,null);
  const a=tennisContextServeAdjustment({},{});
  assert.equal(a.total,0);
  assert.equal(a.completeness.present,0);
});

test("fast indoor context lifts serve and fatigue/injury reduce it",()=>{
  const good=tennisContextServeAdjustment({courtSpeedIndex:1.15,indoor:true,altitudeM:800},{});
  const bad=tennisContextServeAdjustment({hoursSinceLastMatch:18,minutesLast3Days:420,injuryStatus:"limited"},{});
  assert.ok(good.total>0);
  assert.ok(bad.total<0);
});

test("court speed derives from tournament serve environment",()=>{
  const fast=deriveCourtSpeedIndex([{holdPct:.88,aceRate:.12,servePointWin:.69},{holdPct:.86,aceRate:.11,servePointWin:.68}],{tour:"atp"});
  const slow=deriveCourtSpeedIndex([{holdPct:.70,aceRate:.04,servePointWin:.58},{holdPct:.73,aceRate:.05,servePointWin:.60}],{tour:"atp"});
  assert.ok(fast>1);
  assert.ok(slow<1);
});

test("market prior prefers pinnacle and blends betfair when available",()=>{
  const prior=buildSharpMarketPrior({quotes:[
    {book:"pinnacle",p1Price:1.80,p2Price:2.10,format:"decimal"},
    {book:"betfair",p1Price:1.85,p2Price:2.05,format:"decimal",isExchange:true,volume:100000},
    {book:"draftkings",p1Price:-130,p2Price:110,format:"american"}
  ]});
  assert.equal(prior.source,"pinnacle+betfair");
  assert.ok(prior.p1>.5&&prior.p1<.6);
  assert.ok(prior.dispersion>=0);
});

test("market residual stays anchored and never authorizes",()=>{
  const x=tennisMarketResidualProjection({
    fundamentalP1:.72,
    market:{p1:.60,source:"pinnacle"},
    actionIntel:{publicSplits:{markets:[{market:"ML",ticketPct:40,moneyPct:65,moneyTicketGap:25}]}}
  });
  assert.ok(x.p1>.60&&x.p1<.72);
  assert.equal(x.canAuthorizeWager,false);
  assert.equal(x.action.sharpLabel,null);
});

test("movement features capture velocity and reversals",()=>{
  const m=deriveMarketMovementFeatures([
    {p1:.50,observedAt:"2026-10-05T12:00:00Z"},
    {p1:.54,observedAt:"2026-10-05T13:00:00Z"},
    {p1:.52,observedAt:"2026-10-05T14:00:00Z"},
  ]);
  assert.equal(m.n,3);
  assert.equal(m.reversals,1);
  assert.ok(Math.abs(m.move-.02)<1e-9);
});

test("v2 fundamental and market layers stay separated",()=>{
  const game={id:"t1",tour:"atp",surface:"hard",bestOf:3,player1:p("A",.65,.37),player2:p("B",.62,.34),
    playerContexts:[{courtSpeedIndex:1.08,hoursSinceLastMatch:48},{hoursSinceLastMatch:20,minutesLast3Days:380}],
    marketQuotes:[{book:"pinnacle",p1Price:1.70,p2Price:2.20,format:"decimal"}]};
  const pure=simulateTennisV2(game,{simulations:200},{seed:"v2",researchBacktest:true});
  assert.equal(pure.marketInformed,false);
  assert.equal(pure.fundamentalOnly,true);
  const combo=simulateTennisMarketV2(game,{simulations:200},{seed:"v2m",researchBacktest:true});
  assert.equal(combo.governance.pureModelMarketFree,true);
  assert.equal(combo.governance.canAuthorizeWager,false);
  assert.ok(Number.isFinite(combo.market.p1));
});

test("ACTION actor input preserves tennis sharp-gap research filters",()=>{
  const i=buildActorInput({leagues:["atp"],maxItems:5,freePlan:false,minSharpGap:12.5,minNumBets:100,sortBy:"sharpGap",includeLineMovement:true});
  assert.equal(i.minSharpGap,12.5);
  assert.equal(i.minBets,100);
  assert.equal(i.sortBy,"sharpGap");
});
