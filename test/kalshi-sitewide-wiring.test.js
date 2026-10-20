import test from "node:test";
import assert from "node:assert/strict";
import {classifyKalshiSportContract,verifyKalshiEventIdentity,kalshiPropAndComboGate} from "../functions/lib/kalshiContractIdentity.js";
import {auditKalshiFillReconciliation} from "../functions/lib/kalshiFillReconciliation.js";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
const ui=readFileSync(new URL("../src/features/market/KalshiMarketResearch.jsx",import.meta.url),"utf8");

test("fixture matching requires two full teams, provider kickoff and exact event ticker",()=>{
 const fixture={id:"nfl-verified-abc",startTime:"2026-10-25T17:00:00Z",
   home_name:"New York Giants",away_name:"Dallas Cowboys"};
 const event={event_ticker:"KXNFLGAME-26OCT25",title:"Dallas Cowboys at New York Giants",
   verifiedGameStartTime:"2026-10-25T17:00:00Z"};
 const market={event_ticker:event.event_ticker};
 const matched=verifyKalshiEventIdentity({fixture,event,market});
 assert.equal(matched.matched,true);
 assert.equal(matched.canonicalEventId,fixture.id);
 assert.equal(matched.sideVerified,false);
 assert.equal(matched.canQualify,false);
 assert.equal(matched.executionEligible,false);
 for(const bad of [
  {...event,title:"Dallas Cowboys at New York Jets"},
  {...event,verifiedGameStartTime:null},
  {...event,verifiedGameStartTime:"2026-10-25T23:00:00Z"},
 ]){
  const r=verifyKalshiEventIdentity({fixture,event:bad,market});
  assert.equal(r.matched,false);
  assert.equal(r.canonicalEventId,null);
 }
 assert.equal(verifyKalshiEventIdentity({fixture,event,market:{event_ticker:"WRONG"}}).matched,false);
});

test("player props and combos cannot be qualified from headline or MVE selected legs alone",()=>{
 const prop=kalshiPropAndComboGate({ticker:"KXNFLPASS-TEST",title:"Player passing yards over 275.5"});
 assert.equal(prop.family,"player_prop");
 assert.equal(prop.approvedForPlayerProps,false);
 assert.equal(prop.playerId,null);
 assert.equal(prop.settlementVerified,false);
 const combo=kalshiPropAndComboGate({
  ticker:"KXMVE-COMBO-TEST",mve_collection_ticker:"KXMVE",
  mve_selected_legs:[
   {market_ticker:"KXNFLGAME-26OCT25-NY",side:"yes"},
   {market_ticker:"KXNFLGAME-26OCT25-DAL",side:"no"},
  ],
 });
 assert.equal(combo.family,"combo");
 assert.equal(combo.selectedLegs.length,2);
 assert.equal(combo.approvedForCombos,false);
 assert.equal(combo.impliedJointProbability,null);
 assert.equal(combo.quoteExecutable,false);
});

test("private fill reconciliation dedupes exact fill IDs but never infers wins or bets",()=>{
 const fills=[
  {id:"fill-1",ticker:"KXNFLGAME-1",filledAt:"2026-10-20T05:00:00Z"},
  {id:"fill-1",ticker:"KXNFLGAME-1",filledAt:"2026-10-20T05:00:00Z"},
  {id:"fill-2",ticker:"KXNCAAFGAME-2"},
  {id:null,ticker:"KXNFLGAME-3"},
 ];
 const manual=[
  {provider:"Kalshi",exchangeFillId:"fill-1"},
  {provider:"Polymarket",exchangeFillId:"fill-2"},
 ];
 const result=auditKalshiFillReconciliation(fills,manual);
 assert.equal(result.recentUniqueFills,2);
 assert.equal(result.invalidFillRows,1);
 assert.equal(result.reconciledByExactFillId,1);
 assert.equal(result.notMatchedToFbisBets,1);
 assert.equal(result.ledgerWrites,0);
 assert.equal(result.verifiedWinRate,false);
 assert.equal(result.verifiedLifetimeProfit,false);
 assert.equal(result.canSettleBets,false);
});
test("Market and Player Props research UI are wired but not to CORE or auto bets",()=>{
 assert.match(app,/import KalshiMarketResearch/);
 assert.match(app,/KalshiMarketResearch variant="market"/);
 assert.match(app,/KalshiMarketResearch variant="props"/);
 assert.match(ui,/SHADOW · NOT EXECUTABLE/);
 assert.match(ui,/No automatic upstream quote polling from this page/);
 assert.match(ui,/classifyKalshiSportContract/);
 assert.doesNotMatch(ui,/placeOrder|sendOrder|authorizeWager|setProjection|setBet/);
});
