import test from "node:test";
import assert from "node:assert/strict";
import {nbaBoardVenueComparison} from "../functions/lib/nbaBoardVenueComparison.js";
const base={id:"4019001",sport:"nba",start:"2026-10-26T23:00:00Z",nbaFbisV1:{canQualify:true},
 nbaMarketProbabilities:{"ml|HOME|":{probability:.62,qualified:true}}};
test("all three board venue references remain blocked without execution provenance",()=>{
 const game={...base,pinnoddsResearch:{offers:[{source:"PinnOdds",marketFamily:"moneyline",side:"home",decimalOdds:1.85,capturedAt:"2026-10-26T18:00:00Z"}]},
 market:{venueOffers:[{source:"Polymarket US WebSocket",marketFamily:"moneyline",side:"home",contractPrice:.56,observedAt:"2026-10-26T18:00:00Z"},
 {source:"Kalshi",marketFamily:"moneyline",side:"home",yesAskDollars:.57,observedAt:"2026-10-26T18:00:00Z"}]}};
 const result=nbaBoardVenueComparison(game,{now:"2026-10-26T18:05:00Z"});
 assert.equal(result.observedOffers,3);assert.equal(result.offeredVenueCount,3);
 assert.equal(result.best,null);assert.equal(result.excluded.length,3);
 assert.equal(result.canAuthorizeWager,false);
});
test("only truly confirmed execution quote and calibrated model can rank",()=>{
 const o={source:"PinnOdds",marketFamily:"moneyline",side:"home",decimalOdds:1.95,
 providerObservedAt:"2026-10-26T18:00:00Z",providerTimestampVerified:true,executionEligible:true,
 executionEvidence:{quoteVerified:true,actionable:true,settlementEquivalent:true,feePerUnit:0,otherCostPerUnit:0}};
 const r=nbaBoardVenueComparison({...base,pinnoddsResearch:{offers:[o]}},{now:"2026-10-26T18:02:00Z"});
 assert.equal(r.best?.venue,"Pinnacle");assert.equal(r.best?.market,"ml");
 assert.equal(r.canAuthorizeWager,false);
});
test("scores alone or missing odds cannot invent model probabilities",()=>{
 const r=nbaBoardVenueComparison({...base,nbaMarketProbabilities:undefined,
 pinnoddsResearch:{offers:[{source:"PinnOdds",marketFamily:"moneyline",side:"home",decimalOdds:2,
 providerObservedAt:"2026-10-26T18:00:00Z",providerTimestampVerified:true,executionEligible:true,
 executionEvidence:{quoteVerified:true,actionable:true,settlementEquivalent:true,feePerUnit:0,otherCostPerUnit:0}}]}},
 {now:"2026-10-26T18:02:00Z"});
 assert.equal(r.best,null);assert.equal(r.excluded[0].reasons.includes("MODEL_NOT_QUALIFIED"),true);
});
