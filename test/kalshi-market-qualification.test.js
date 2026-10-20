import test from "node:test";
import assert from "node:assert/strict";
import {qualifyKalshiGameMarket} from "../functions/lib/kalshiMarketQualification.js";
const now=new Date("2026-10-20T15:00:00Z");
const fixture={id:"fbis-fixture-42",home_name:"Seattle",away_name:"Chicago",startTime:"2026-11-02T01:00:00Z"};
const event={event_ticker:"KXNFLGAME-26NOV02CHISEA",title:"Chicago at Seattle",verifiedGameStartTime:fixture.startTime};
const market={ticker:"KXNFLGAME-26NOV02CHISEA-SEA",eventTicker:event.event_ticker,title:"Seattle wins",yesLabel:"Seattle",status:"active",rulesPrimary:"Seattle wins the game",rulesSecondary:"Tie settles at half; postponement and cancellation exceptions"};
const orderbook={orderbook_fp:{yes_dollars:[["0.4","5"]],no_dollars:[["0.42","7"]]}};
const settlement={verified:true,eventTicker:event.event_ticker,marketTicker:market.ticker,yesParticipant:"Seattle",fullGame:true,tiePolicyReviewed:true,postponementReviewed:true,cancellationReviewed:true,payoutDollars:1};
const feeEvidence={verified:true,marketTicker:market.ticker,quantity:2,totalFeeDollars:0.04,verifiedAt:now.toISOString()};
const base={sport:"nfl",fixture,event,market,orderbook,settlement,feeEvidence,requestedContracts:2,modelProbability:0.62,bookObservedAt:now.toISOString(),now};
test("complete supplied evidence yields research comparison only, not executable authority",()=>{
 const r=qualifyKalshiGameMarket(base);
 assert.equal(r.eventIdentityVerified,true);
 assert.equal(r.outcomeSettlementVerified,true);
 assert.equal(r.observedTopYesAskDollars,0.58);
 assert.equal(r.topYesAskSizeContracts,7);
 assert.ok(Math.abs(r.indicativeNetEdge-0.02)<1e-9);
 assert.deepEqual(r.reasons,["EXCHANGE_QUOTE_CLOCK_UNVERIFIED"]);
 assert.equal(r.comparabilityCandidate,true);
 assert.equal(r.executionEligible,false);
 assert.equal(r.canPublishMarketOdds,false);
});
test("wrong participant and settlement mismatch fail closed",()=>{
 const r=qualifyKalshiGameMarket({...base,market:{...market,yesLabel:"Dallas"}});
 assert.ok(r.reasons.includes("OUTCOME_AND_SETTLEMENT_NOT_VERIFIED"));
 assert.equal(r.comparabilityCandidate,false);
});
test("book depth, aged REST observation and unknown fee never invent net economics",()=>{
 const r=qualifyKalshiGameMarket({...base,requestedContracts:8,bookObservedAt:"2026-10-20T14:00:00Z",feeEvidence:null});
 assert.ok(r.reasons.includes("TOP_LEVEL_LIQUIDITY_INSUFFICIENT"));
 assert.ok(r.reasons.includes("ORDERBOOK_OBSERVATION_STALE_OR_MISSING"));
 assert.ok(r.reasons.includes("FEE_SCHEDULE_NOT_VERIFIED"));
 assert.equal(r.indicativeNetEdge,null);
 assert.equal(r.executionEligible,false);
});
test("empty and combo/prop contracts cannot qualify",()=>{
 const blank=qualifyKalshiGameMarket({});
 assert.equal(blank.executionEligible,false);
 assert.ok(blank.reasons.length>2);
 const prop=qualifyKalshiGameMarket({...base,market:{...market,title:"Seattle player passing yards",yesLabel:"Seattle"}});
 assert.ok(prop.reasons.includes("CONTRACT_FAMILY_NOT_GAME_WINNER"));
});
