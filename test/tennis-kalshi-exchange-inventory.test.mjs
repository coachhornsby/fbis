import test from "node:test";
import assert from "node:assert/strict";
import {kalshiTennisContractPairs,mergeKalshiTennisCards}
 from "../functions/lib/tennisKalshiInventory.js";
const now=new Date("2026-10-21T14:00:00Z");
const expiry="2026-10-21T20:00:00Z";
const eventTicker="KXATPMATCH-26OCT21DODCEC";
const common={sport:"atp",status:"active",eventTicker,
 fetchedAt:"2026-10-21T13:56:00Z",expectedExpirationAt:expiry,
 rulesPrimary:"This professional tennis match is between Matej Dodig and Marco Cecchinato."};
const rows=[
 {...common,ticker:eventTicker+"-DOD",yesLabel:"Matej Dodig",yesAskDollars:0.72,yesBidDollars:0.69},
 {...common,ticker:eventTicker+"-CEC",yesLabel:"Marco Cecchinato",yesAskDollars:0.30,yesBidDollars:0.28}
];
const kalshi={atp:rows,wta:[],status:"RESEARCH_SNAPSHOT",atpStatus:"COMPLETE_RESEARCH_SNAPSHOT"};
test("Kalshi creates two-sided ATP contract inventory without Polymarket or ESPN",()=>{
 const events=kalshiTennisContractPairs(kalshi,now);
 assert.equal(events.length,1);
 assert.equal(events[0].offers.length,2);
 assert.equal(events[0].offers[0].yesAskDollars,0.30);
 assert.equal(events[0].canAuthorizeWager,false);
 const result=mergeKalshiTennisCards([],kalshi,{date:"2026-10-21",now});
 assert.equal(result.added.length,1);
 const game=result.games[0];
 assert.equal(game.id,"tennis:kalshi:atp:"+eventTicker);
 assert.equal(game.tennisProjection.researchFixture.source,"KALSHI_PUBLIC_SHADOW");
 assert.equal(game.tennisProjection.player1WinProb,null);
 assert.equal(game.startTimeBasis,"KALSHI_CONTRACT_EXPIRATION_ONLY");
 assert.equal(game.tennisProjection.kalshiResearchOffers.length,2);
 assert.equal(game.canAuthorizeWager,false);
 assert.equal(game.market.marketAvailable,false);
});
test("Kalshi enriches independently scheduled Polymarket card with two outcomes",()=>{
 const game={id:"tennis:polyus:atp:555",sport:"tennis",tour:"atp",start:expiry,
  home:{name:"Matej Dodig"},away:{name:"Marco Cecchinato"},
  tennisProjection:{researchFixture:{source:"POLYMARKET_US_PUBLIC",verified:true},
   player1WinProb:null,venueOffers:[{source:"Polymarket US",contractPrice:.65}]}};
 const r=mergeKalshiTennisCards([game],kalshi,{date:"2026-10-21",now});
 assert.equal(r.added.length,0);
 assert.equal(r.games[0].id,game.id);
 assert.equal(r.games[0].tennisProjection.kalshiResearchOffers.length,2);
 assert.equal(r.games[0].tennisProjection.venueOffers[0].contractPrice,.65);
});
test("Kalshi cannot turn provider administrative expiry into an FBIS win prediction",()=>{
 const game={id:"projected",sport:"tennis",tour:"atp",start:expiry,
 home:{name:"Matej Dodig"},away:{name:"Marco Cecchinato"},
 tennisProjection:{player1WinProb:.57,eventIntegrity:{valid:true},venueOffers:[]}};
 const r=mergeKalshiTennisCards([game],kalshi,{date:"2026-10-21",now});
 assert.equal(r.added.length,0);
 assert.equal(r.games[0].tennisProjection.player1WinProb,.57);
 assert.equal(r.games[0].tennisProjection.kalshiResearchOffers.length,2);
});
test("one-sided, stale, mismatched rules, and provider-expired Kalshi offers do not become matches",()=>{
 const bad=[
  {...kalshi,atp:[rows[0]]},
  {...kalshi,atp:rows.map(r=>({...r,fetchedAt:"2026-10-21T10:00:00Z"}))},
  {...kalshi,atp:rows.map(r=>({...r,rulesPrimary:"This professional tennis match features unrelated players."}))},
  {...kalshi,atp:rows.map(r=>({...r,expectedExpirationAt:"2026-10-18T20:00:00Z"}))}
 ];
 for(const source of bad){
  assert.deepEqual(kalshiTennisContractPairs(source,now),[]);
  assert.equal(mergeKalshiTennisCards([],source,{date:"2026-10-21",now}).games.length,0);
 }
});
test("Kalshi-only expirations are included only in their explicitly labeled date bucket",()=>{
 const result=mergeKalshiTennisCards([],kalshi,{date:"2026-10-22",now});
 assert.equal(result.added.length,0);
});
