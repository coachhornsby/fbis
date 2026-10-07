import test from "node:test";import assert from "node:assert/strict";
import { normalizeMarketOffer,priceMarketOffer,decimalFromAmerican } from "../functions/lib/normalizedMarket.js";
import { normalizeDraftKingsEvents,normalizeDraftKingsPlayerRows } from "../functions/lib/draftKingsAdapter.js";
import { compareMarketOffers } from "../functions/lib/marketAggregator.js";

test("normalized schema preserves nulls and sportsbook price",()=>{
 const o=normalizeMarketOffer({source:"draftkings",sourceType:"sportsbook",sport:"tennis",marketFamily:"player_prop",statFamily:"aces",side:"over",line:7.5,americanOdds:-125});
 assert.equal(o.playerId,null);assert.equal(o.decimalOdds,1.8);assert.equal(decimalFromAmerican(105),2.05);
});
test("exact sportsbook economics keep edge separate from EV",()=>{
 const x=priceMarketOffer({source:"draftkings",sourceType:"sportsbook",americanOdds:105},{modelProbability:.58});
 assert.ok(Math.abs(x.rawImpliedProbability-.487804878)<1e-8);assert.ok(Math.abs(x.probabilityEdge-.092195122)<1e-8);assert.ok(Math.abs(x.expectedReturnPerUnitRisk-.189)<1e-10);
});
test("two-sided price produces no-vig probability",()=>{
 const x=priceMarketOffer({source:"draftkings",sourceType:"sportsbook",americanOdds:-115},{modelProbability:.6,pairedAmericanOdds:-105});
 assert.ok(x.noVigMarketProbability>.5&&x.noVigMarketProbability<.53);
});
test("DraftKings game adapter retains venue offers instead of compressing them",()=>{
 const r=normalizeDraftKingsEvents([{id:"e1",home_team:"A",away_team:"B",commence_time:"2026-10-08T00:00:00Z",bookmakers:[{key:"draftkings",markets:[
  {key:"h2h",outcomes:[{name:"A",price:125},{name:"B",price:-145}]},{key:"spreads",outcomes:[{name:"A",price:-105,point:3.5,_main:true},{name:"B",price:-115,point:-3.5,_main:true}]},
  {key:"totals",outcomes:[{name:"Over",price:-110,point:47.5},{name:"Under",price:-110,point:47.5}]}]}]}],{sport:"nfl"});
 assert.equal(r.offers.length,6);assert.equal(r.offers.filter(x=>x.marketFamily==="moneyline").length,2);assert.ok(r.offers.every(x=>x.source==="draftkings"));
});
test("DraftKings player props map only production-supported semantics",()=>{
 const r=normalizeDraftKingsPlayerRows([
  {sportsbook:"draftkings",event_id:"e",player_name:"Pitcher A",market_type:"Pitcher Strikeouts",selection_type:"over",line:6.5,odds_american:-115,is_main_line:true},
  {sportsbook:"draftkings",event_id:"e",player_name:"QB A",market_type:"Rush + Receiving Yards",selection_type:"over",line:40.5,odds_american:-110,is_main_line:true}
 ],{sport:"mlb"});
 assert.equal(r.offers.length,1);assert.equal(r.offers[0].statFamily,"strikeouts");
});
test("aggregator evaluates model probability independently at each threshold",()=>{
 const model={probabilityAtLine:({line,side})=>side==="over"?(line===7.5?.63:.48):(line===7.5?.37:.52)};
 const offers=[
  {source:"underdog",sourceType:"pickem",sport:"tennis",eventId:"e",playerName:"Roman Safiullin",marketFamily:"player_prop",statFamily:"aces",side:"over",line:7.5,fetchedAt:"2026-10-07T12:00:00Z"},
  {source:"draftkings",sourceType:"sportsbook",sport:"tennis",eventId:"e",playerName:"Roman Safiullin",marketFamily:"player_prop",statFamily:"aces",side:"over",line:7.5,americanOdds:-115,fetchedAt:"2026-10-07T12:00:00Z"},
  {source:"prizepicks",sourceType:"pickem",sport:"tennis",eventId:"e",playerName:"Roman Safiullin",marketFamily:"player_prop",statFamily:"aces",side:"over",line:8.5,fetchedAt:"2026-10-07T12:00:00Z"}
 ];
 const r=compareMarketOffers({model,offers,nowMs:Date.parse("2026-10-07T12:05:00Z")});
 assert.equal(r.comparisons[0].bestOverThreshold.line,7.5);assert.equal(r.comparisons[0].largestThresholdDiscrepancy,1);assert.equal(r.authority.canAuthorize,false);
 const dk=r.offers.find(x=>x.source==="draftkings");assert.equal(dk.modelProbability,.63);assert.ok(dk.expectedReturnPerUnitRisk>0);
 const pp=r.offers.find(x=>x.source==="prizepicks");assert.equal(pp.modelProbability,.48);assert.equal(pp.expectedReturnPerUnitRisk,null);
});
test("2+ threshold gap is verify-outlier, not stronger bet",()=>{
 const model={probability:.55};const r=compareMarketOffers({model,offers:[
  {source:"draftkings",sourceType:"sportsbook",sport:"nfl",eventId:"e",marketFamily:"spread",side:"home",line:-2.5,americanOdds:-110,fetchedAt:"2026-10-07T12:00:00Z"},
  {source:"heritage",sourceType:"sportsbook",sport:"nfl",eventId:"e",marketFamily:"spread",side:"home",line:-4.5,americanOdds:-105,fetchedAt:"2026-10-07T12:00:00Z"}
 ],nowMs:Date.parse("2026-10-07T12:05:00Z")});
 assert.equal(r.comparisons[0].lineShoppingFlag,"VERIFY_OUTLIER");assert.equal(r.comparisons[0].governance,"INFORMATIONAL_ONLY");
});
