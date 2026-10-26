import test from "node:test";
import assert from "node:assert/strict";
import {nbaNetWagerCandidates} from "../functions/lib/nbaLiveVenueRanker.js";
const base={gameId:"4019001",market:"ml",outcome:"HOME",modelProbability:.62,modelQualified:true,
 capturedAt:"2026-10-26T18:00:00Z",tipoff:"2026-10-26T23:00:00Z",
 quoteVerified:true,actionable:true,settlementEquivalent:true,feePerUnit:0,otherCostPerUnit:0};
const now="2026-10-26T18:05:00Z";
test("ranks three verified venues by modeled net EV, without a closing price",()=>{
 const offers=[
  {...base,venue:"Pinnacle",americanOdds:-150},
  {...base,venue:"Kalshi",yesPrice:.57,isYesContract:true,feePerUnit:.015},
  {...base,venue:"Polymarket",yesPrice:.59,isYesContract:true,feePerUnit:.005}
 ];
 const r=nbaNetWagerCandidates({offers,now});
 assert.equal(r.ranked.length,3);
 assert.equal(r.best.venue,"Kalshi");
 assert.equal(r.closingPriceRequired,false);
 assert.equal(r.canAuthorizeWager,false);
 assert.equal(r.combinationsEnabled,false);
});
test("rejects stale, posttipoff, missing fee, and unverified venue quote",()=>{
 const r=nbaNetWagerCandidates({offers:[
  {...base,venue:"Pinnacle",americanOdds:-120,capturedAt:"2026-10-26T17:00:00Z"},
  {...base,venue:"Kalshi",yesPrice:.52,isYesContract:true,feePerUnit:null},
  {...base,venue:"Polymarket",yesPrice:.53,isYesContract:true,quoteVerified:false},
  {...base,venue:"Pinnacle",americanOdds:150,tipoff:"2026-10-26T18:01:00Z"}
 ],now});
 assert.equal(r.best,null);assert.equal(r.excluded.length,4);
});
test("line and settlement identity must be verified for spread and total",()=>{
 const r=nbaNetWagerCandidates({offers:[
  {...base,venue:"Pinnacle",market:"spread",line:null,americanOdds:-105},
  {...base,venue:"Pinnacle",market:"total",line:224.5,americanOdds:-105,settlementEquivalent:false}
 ],now});
 assert.equal(r.ranked.length,0);
});
