import test from "node:test";
import assert from "node:assert/strict";
import {buildMoneylinePriceComparison} from "../src/lib/marketPriceComparison.js";

const fixture={
 sport:"nfl",home:{name:"Denver Broncos",abbr:"DEN"},away:{name:"Seattle Seahawks",abbr:"SEA"},
 pHome:0.4352110084692069,canAuthorizeWager:false,
 pinnoddsResearch:{offers:[
  {source:"PinnOdds",marketFamily:"moneyline",period:"full_game",side:"home",decimalOdds:2.2,capturedAt:"2026-10-15T06:27:36Z"},
  {source:"PinnOdds",marketFamily:"moneyline",period:"full_game",side:"away",decimalOdds:1.735,capturedAt:"2026-10-15T06:27:36Z"}
 ]},
 market:{venueOffers:[
  {source:"Polymarket US WebSocket",marketFamily:"moneyline",period:"full_game",side:"seahawks",contractPrice:0.5675,sourceObservedAt:"2026-10-15T19:51:22Z",quoteKind:"OBSERVED_BBO_NOT_GUARANTEED_FILL"},
  {source:"Polymarket US",marketFamily:"moneyline",period:"full_game",side:"seahawks",contractPrice:0.55,collectedAt:"2026-10-15T18:00:00Z"}
 ]}
};

test("five required fields stay aligned to the same NFL team, sourced independently",()=>{
 const x=buildMoneylinePriceComparison(fixture);
 assert.equal(x.rows[0].label,"Seattle Seahawks");
 assert.equal(x.rows[0].pinnoddsAmerican,-136);
 assert.equal(x.rows[0].polymarketProbability,0.5675);
 assert.equal(x.rows[0].polymarketAmerican,-131);
 assert.ok(Math.abs(x.rows[0].fbisProbability-0.5647889915307931)<1e-10);
 assert.equal(x.rows[0].fbisFairAmerican,-130);
 assert.equal(x.rows[1].label,"Denver Broncos");
 assert.equal(x.rows[1].pinnoddsAmerican,120);
 assert.equal(x.rows[1].polymarketProbability,null);
 assert.equal(x.rows[1].fbisFairAmerican,130);
 assert.equal(x.researchOnly,true);
});

test("unmatched Polymarket selection is omitted instead of assigned to a team",()=>{
 const x=buildMoneylinePriceComparison({...fixture,market:{venueOffers:[{source:"Polymarket US WebSocket",marketFamily:"moneyline",period:"full_game",side:"unmapped",contractPrice:.8}]}});
 assert.equal(x.rows[0].polymarketProbability,null);
 assert.equal(x.rows[1].polymarketProbability,null);
});
test("alternate period Polymarket prices never mix with full game",()=>{
 const x=buildMoneylinePriceComparison({...fixture,market:{venueOffers:[{source:"Polymarket US WebSocket",marketFamily:"moneyline",period:"first_half",side:"seahawks",contractPrice:.6}]}});
 assert.equal(x.rows[0].polymarketProbability,null);
});
test("soccer draw remains separate; no away complement is invented",()=>{
 const x=buildMoneylinePriceComparison({sport:"soccer",home:{name:"Arsenal"},away:{name:"Chelsea"},pHome:0.65,
   market:{venueOffers:[{source:"Polymarket US",marketFamily:"moneyline",period:"full_game",side:"draw",contractPrice:.2}]}});
 assert.equal(x.rows.length,3);
 assert.deepEqual(x.rows.map(r=>r.side),["away","draw","home"]);
 assert.equal(x.rows[2].fbisProbability,null);
 assert.equal(x.rows[0].fbisProbability,null);
 assert.equal(x.rows[1].polymarketAmerican,400);
});
test("model probability 0 or missing does not make a false fair price",()=>{
 const x=buildMoneylinePriceComparison({...fixture,pHome:0});
 assert.equal(x.rows[0].fbisProbability,null);
 assert.equal(x.rows[0].fbisFairAmerican,null);
});

test("NHL priceboard displays independently projected win chance without granting wagering authority",()=>{
 const game={sport:"nhl",home:{name:"Montreal Canadiens",abbr:"MTL"},away:{name:"San Jose Sharks",abbr:"SJ"},
  canQualify:false,canAuthorizeWager:false,
  nhlProV2:{ok:true,independent:true,marketInformed:false,
   probability:{homeWinIncludingOt:0.655}},
  market:{venueOffers:[]}};
 const card=buildMoneylinePriceComparison(game);
 assert.equal(card.rows.find(x=>x.side==="home").fbisProbability,0.655);
 assert.equal(card.rows.find(x=>x.side==="away").fbisProbability,0.345);
 assert.equal(card.researchOnly,true);
 assert.equal(card.rows.find(x=>x.side==="home").polymarketProbability,null);
});
test("NHL market-derived or unverified research cannot supply the fair moneyline",()=>{
 const base={sport:"nhl",home:{name:"Montreal Canadiens"},away:{name:"San Jose Sharks"},market:{venueOffers:[]}};
 for(const model of [{ok:true,independent:false,marketInformed:false},{ok:true,independent:true,marketInformed:true},{ok:false,independent:true,marketInformed:false}]){
  const x=buildMoneylinePriceComparison({...base,nhlProV2:{...model,probability:{homeWinIncludingOt:0.7}}});
  assert.equal(x.rows[1].fbisProbability,null);
 }
});
